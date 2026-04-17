# B2B Marketplace - Deployment Guide & Budget Management

## Table of Contents
1. [System Trade-offs & Gaps](#1-system-trade-offs--gaps)
2. [Recommended Improvements (In-Scope)](#2-recommended-improvements-in-scope)
3. [AWS Deployment Step-by-Step](#3-aws-deployment-step-by-step)
4. [Budget Management ($50 Learner Lab)](#4-budget-management-50-learner-lab)
5. [Daily Checklist](#5-daily-checklist)

---

## 1. System Trade-offs & Gaps

### Current Architecture Trade-offs

| Trade-off | Current Choice | Why | Impact |
|---|---|---|---|
| **Shared Database** | Both services use same RDS MySQL | Simpler setup, saves budget (1 RDS instead of 2) | Not ideal microservices pattern, but acceptable for this project scope |
| **No Authentication** | Hardcoded `shop_id: 1` | Keeps project focused on microservices + AWS, not auth | Mention in report as simplification |
| **Synchronous Communication** | Services share DB directly, no message queue | SQS/SNS would add complexity and cost | For 2 services this is fine; note in report that async (SQS) would be better at scale |
| **No API Gateway** | ALB routes directly to services | API Gateway costs extra and adds complexity | ALB path-based routing is sufficient for 2 services |
| **Single AZ deployment** | One subnet for cost savings | Multi-AZ doubles RDS cost | Acceptable for demo; mention Multi-AZ for production |
| **EJS server-side rendering** | No separate frontend service | Keeps it simple, fewer containers = less cost | Good for demo purposes |

### Identified Gaps (Minor)

| Gap | Risk Level | Fix Needed? |
|---|---|---|
| No input sanitization/validation middleware | Low (demo only) | Optional - add `express-validator` |
| No rate limiting | Low | Not needed for demo |
| No HTTPS/SSL | Low | ALB can handle SSL termination with ACM cert (free) |
| No environment-specific configs | Low | Current env vars approach is fine |
| Error pages don't show stack traces in dev | Low | Acceptable |
| No automated tests | Medium | Could add basic tests but not required by rubric |

### What NOT to Add (Out of Scope / Budget Risk)

- ❌ **Amazon SQS/SNS** - adds cost, not required
- ❌ **Amazon API Gateway** - $3.50/million requests, ALB is enough
- ❌ **ElastiCache/Redis** - unnecessary for this scale
- ❌ **Multi-AZ RDS** - doubles DB cost
- ❌ **NAT Gateway** - ~$0.045/hr ($32/month!) - use public subnets instead
- ❌ **Multiple environments (dev/staging/prod)** - one environment is enough
- ❌ **Amazon Cognito** - auth is not the focus

---

## 2. Recommended Improvements (In-Scope, No Extra Cost)

### 2.1 Add Search Route to Shop (already done ✅)
Products already support search via query parameter.

### 2.2 Add Graceful Shutdown (Free, Better Demo)
Already using connection pools which handle this better.

### 2.3 For the Demo - Show This Workflow (Saga Pattern)
This is what the graders want to see:

```
1. Shop browses products → sees stock = 100
2. Shop creates order (qty: 10) → stock becomes 90 (Saga Step 1: Reserve)
3. Supplier confirms order → status: confirmed
4. Supplier processes payment → status: paid (Saga Step 2: Payment)
5. [FAILURE DEMO] Create another order, confirm it, then show payment failure
   → Order auto-cancelled, stock restored (Saga Compensating Transaction)
6. [CANCEL DEMO] Create order, then cancel → stock restored
```

### 2.4 For the Report - Architecture Diagram Should Show

```
┌─────────────┐       ┌──────────────────────────────────┐
│   Browser    │       │         AWS Cloud (us-east-1)     │
│  (Customer)  │──────▶│                                   │
└─────────────┘       │  ┌─────────────────────────────┐  │
                      │  │   Application Load Balancer   │  │
                      │  │   / → Shop (port 8080)        │  │
                      │  │   /admin/* → Supplier (8080)   │  │
                      │  └──────┬──────────┬─────────────┘  │
                      │         │          │                 │
                      │  ┌──────▼───┐ ┌────▼──────────┐    │
                      │  │ ECS Task │ │  ECS Task      │    │
                      │  │  (Shop)  │ │  (Supplier)    │    │
                      │  │ Fargate  │ │  Fargate       │    │
                      │  └──────┬───┘ └────┬───────────┘    │
                      │         │          │                 │
                      │  ┌──────▼──────────▼─────────────┐  │
                      │  │     Amazon RDS (MySQL)         │  │
                      │  │     db.t3.micro                │  │
                      │  └───────────────────────────────┘  │
                      │                                     │
                      │  ┌─────────────────────────────┐    │
                      │  │  CI/CD: CodePipeline          │   │
                      │  │  CodeCommit → CodeBuild → ECS │   │
                      │  └─────────────────────────────┘    │
                      │                                     │
                      │  ┌─────────────────────────────┐    │
                      │  │  CloudWatch Logs              │   │
                      │  │  /ecs/shop, /ecs/supplier     │   │
                      │  └─────────────────────────────┘    │
                      └─────────────────────────────────────┘
```

---

## 3. AWS Deployment Step-by-Step

### 3.1 Create RDS MySQL Instance
1. Go to RDS Console → Create Database
2. **Engine**: MySQL 8.0
3. **Template**: Free tier (or Dev/Test)
4. **Instance**: `db.t3.micro` (cheapest!)
5. **Storage**: 20 GB gp2 (minimum)
6. **Multi-AZ**: ❌ NO (saves money)
7. **Public access**: Yes (for initial setup, disable later)
8. **DB name**: `b2bmarket`
9. **Master username**: `admin`
10. **Master password**: `lab-password`
11. **Disable Enhanced Monitoring** (not supported in lab)
12. After creation, run `deployment/db-init.sql` using MySQL client

### 3.2 Create ECR Repositories
```bash
aws ecr create-repository --repository-name shop --region us-east-1
aws ecr create-repository --repository-name supplier --region us-east-1
```

### 3.3 Build & Push Docker Images
```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

# Build and push Shop
cd microservices/shop
docker build -t shop .
docker tag shop:latest <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/shop:latest
docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/shop:latest

# Build and push Supplier
cd ../supplier
docker build -t supplier .
docker tag supplier:latest <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/supplier:latest
docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/supplier:latest
```

### 3.4 Create ECS Cluster
1. Go to ECS Console → Create Cluster
2. **Name**: `b2b-marketplace`
3. **Infrastructure**: AWS Fargate (serverless)

### 3.5 Create Task Definitions
1. Update `deployment/taskdef-shop.json` and `taskdef-supplier.json`:
   - Replace `<IMAGE1_NAME>` with your ECR image URI
   - Replace `<ACCOUNT-ID>` with your AWS account ID
   - Replace `<RDS-ENDPOINT>` with your RDS endpoint
2. Register task definitions:
```bash
aws ecs register-task-definition --cli-input-json file://deployment/taskdef-shop.json
aws ecs register-task-definition --cli-input-json file://deployment/taskdef-supplier.json
```

### 3.6 Create Application Load Balancer
1. Go to EC2 Console → Load Balancers → Create ALB
2. **Name**: `b2b-alb`
3. **Scheme**: Internet-facing
4. **Listeners**: HTTP:80
5. Create 2 Target Groups:
   - `shop-tg` (port 8080, health check: `/health`)
   - `supplier-tg` (port 8080, health check: `/health`)
6. ALB Listener Rules:
   - Path `/admin/*` → `supplier-tg`
   - Default → `shop-tg`

### 3.7 Create ECS Services
```bash
# Shop service
aws ecs create-service \
  --cluster b2b-marketplace \
  --service-name shop-service \
  --task-definition shop \
  --desired-count 1 \
  --launch-type FARGATE \
  --load-balancers targetGroupArn=<SHOP_TG_ARN>,containerName=shop,containerPort=8080

# Supplier service
aws ecs create-service \
  --cluster b2b-marketplace \
  --service-name supplier-service \
  --task-definition supplier \
  --desired-count 1 \
  --launch-type FARGATE \
  --load-balancers targetGroupArn=<SUPPLIER_TG_ARN>,containerName=supplier,containerPort=8080
```

### 3.8 Set Up CI/CD Pipeline (for at least 1 service)
1. **CodeCommit**: Create repo, push code
2. **CodeBuild**: Create project using `buildspec.yml`
   - Environment: Managed image, Amazon Linux 2, Standard runtime
   - Privileged mode: ✅ (needed for Docker)
   - Environment variables: `AWS_ACCOUNT_ID`, `AWS_DEFAULT_REGION=us-east-1`
3. **CodePipeline**: Source (CodeCommit) → Build (CodeBuild) → Deploy (ECS)

### 3.9 Create CloudWatch Log Groups
```bash
aws logs create-log-group --log-group-name /ecs/shop --region us-east-1
aws logs create-log-group --log-group-name /ecs/supplier --region us-east-1
```

---

## 4. Budget Management ($50 Learner Lab)

### ⚠️ CRITICAL: Your $50 budget must last the entire project!

### Cost Breakdown (Estimated per day if left running 24h)

| Service | Config | Cost/Hour | Cost/Day | Cost/Month |
|---|---|---|---|---|
| **RDS MySQL** | db.t3.micro | $0.017 | **$0.41** | $12.41 |
| **ECS Fargate** (2 tasks) | 0.25 vCPU, 0.5GB each | $0.012 × 2 | **$0.58** | $17.47 |
| **ALB** | 1 ALB | $0.023 | **$0.54** | $16.43 |
| **ECR** | Storage | ~$0.001 | **$0.02** | $0.50 |
| **CloudWatch** | Logs | ~$0.001 | **$0.02** | $0.50 |
| **NAT Gateway** | ⚠️ IF CREATED | $0.045 | **$1.08** | $32.40 |
| **TOTAL (no NAT)** | | ~$0.052 | **~$1.57** | ~$47 |
| **TOTAL (with NAT)** | | ~$0.097 | **~$2.65** | ~$79 ❌ |

### 🔴 TOP BUDGET KILLERS TO AVOID

1. **NAT Gateway** (~$1.08/day) — Use PUBLIC subnets for ECS tasks instead! Set `assignPublicIp: ENABLED` in ECS service network config.
2. **RDS left running** (~$0.41/day) — RDS does NOT auto-stop when lab session ends! Stop it manually.
3. **Forgetting to scale down** — Set ECS desired count to 0 when not using.
4. **Multiple ALBs** — Use 1 ALB with path-based routing for both services.
5. **Large RDS instance** — Always use `db.t3.micro` (smallest).

### 💰 Budget-Saving Actions

#### Before Every Break / End of Day:
```bash
# 1. Scale ECS services to 0 (stops Fargate costs immediately)
aws ecs update-service --cluster b2b-marketplace --service shop-service --desired-count 0
aws ecs update-service --cluster b2b-marketplace --service supplier-service --desired-count 0

# 2. Stop RDS instance (IMPORTANT - won't auto-stop!)
aws rds stop-db-instance --db-instance-identifier b2bmarket-db
```

#### When Resuming Work:
```bash
# 1. Start RDS
aws rds start-db-instance --db-instance-identifier b2bmarket-db
# Wait 3-5 minutes for RDS to be available

# 2. Scale ECS services back up
aws ecs update-service --cluster b2b-marketplace --service shop-service --desired-count 1
aws ecs update-service --cluster b2b-marketplace --service supplier-service --desired-count 1
```

#### ⚠️ RDS Auto-Restart Warning
If you stop an RDS instance, AWS will **automatically restart it after 7 days**. If you're not using it, stop it again or delete it.

### Recommended Budget Timeline

| Phase | Days | Daily Cost | Total |
|---|---|---|---|
| **Setup & Development** (Cloud9) | 3 days | ~$0.50 | $1.50 |
| **Deployment & Testing** (all services running) | 5 days | ~$1.57 | $7.85 |
| **Demo Day** (everything running) | 1 day | ~$1.57 | $1.57 |
| **Buffer** | — | — | $10 |
| **TOTAL ESTIMATED** | | | **~$21** |
| **Remaining Safety Margin** | | | **~$29** |

### 🛑 If Budget Gets Low (<$15 remaining)

1. Delete the ALB (biggest ongoing cost after RDS)
2. Delete ECS services (set desired count to 0)
3. Stop RDS instance
4. Only start everything again on demo day
5. Use `docker-compose.yml` for local development/testing instead

---

## 5. Daily Checklist

### ✅ Before Starting Work
- [ ] Start lab session
- [ ] Start RDS instance (if stopped)
- [ ] Scale ECS services to desired-count 1
- [ ] Check budget in lab interface

### ✅ Before Stopping Work / End of Session
- [ ] **Scale ECS services to 0** (`aws ecs update-service --desired-count 0`)
- [ ] **Stop RDS instance** (`aws rds stop-db-instance`)
- [ ] Verify in console: no running ECS tasks, RDS status = "stopped"
- [ ] Check budget spent today
- [ ] Check if any NAT Gateway exists → DELETE IT if found

### ✅ Before Demo Day
- [ ] Start all services 30 minutes early
- [ ] Test all workflows (create order, confirm, payment, cancel)
- [ ] Prepare screenshots for report
- [ ] Have CloudWatch logs open to show monitoring

### ✅ After Demo (Project Complete)
- [ ] Delete ALL resources to preserve any remaining budget:
  ```bash
  # Delete ECS services
  aws ecs delete-service --cluster b2b-marketplace --service shop-service --force
  aws ecs delete-service --cluster b2b-marketplace --service supplier-service --force
  # Delete ECS cluster
  aws ecs delete-cluster --cluster b2b-marketplace
  # Delete ALB
  # Delete Target Groups
  # Delete RDS instance (skip final snapshot to save time)
  aws rds delete-db-instance --db-instance-identifier b2bmarket-db --skip-final-snapshot
  # Delete ECR repositories
  aws ecr delete-repository --repository-name shop --force
  aws ecr delete-repository --repository-name supplier --force
  ```
