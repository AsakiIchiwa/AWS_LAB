const express = require("express");
const path = require("path");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const app = express();

// --------------- SECURITY ---------------

// HTTP security headers (XSS, clickjacking, MIME sniffing, etc.)
app.use(helmet({
  contentSecurityPolicy: false // disable CSP for EJS + CDN Bootstrap
}));

// CORS - restrict origins in production
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS || "*",
  methods: ["GET", "POST"]
}));

// Rate limiting - prevent brute force / DDoS
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // max 200 requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests from this IP, please try again later."
});
app.use(limiter);

// Stricter rate limit for write operations
const writeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // max 20 write ops per minute per IP
  message: "Too many write operations. Please wait a moment."
});

// --------------- PERFORMANCE ---------------

// Gzip compression for responses
app.use(compression());

// Request logging
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// --------------- APP CONFIG ---------------

// View engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Static files with cache headers
app.use(express.static(path.join(__dirname, "public"), {
  maxAge: process.env.NODE_ENV === "production" ? "1d" : 0
}));

// Body parser with size limits (prevent large payload attacks)
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(express.json({ limit: "1mb" }));

// Trust proxy (required behind ALB for correct IP in rate limiter)
app.set("trust proxy", 1);

// --------------- HEALTH CHECK ---------------

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "supplier",
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// --------------- ROUTES ---------------

const productController = require("./app/controller/product.controller");
const orderController = require("./app/controller/order.controller");
const paymentController = require("./app/controller/payment.controller");

// Dashboard
app.get("/admin/", (req, res) => {
  res.render("dashboard");
});

// Products - full CRUD (write operations have stricter rate limit)
app.get("/admin/products", productController.findAll);
app.get("/admin/products/add", productController.createForm);
app.post("/admin/products", writeLimiter, productController.create);
app.get("/admin/products/edit/:id", productController.editForm);
app.post("/admin/products/update/:id", writeLimiter, productController.update);
app.post("/admin/products/delete/:id", writeLimiter, productController.remove);

// Orders - manage (write operations have stricter rate limit)
app.get("/admin/orders", orderController.findAll);
app.get("/admin/orders/:id", orderController.findOne);
app.post("/admin/orders/:id/confirm", writeLimiter, orderController.confirm);
app.post("/admin/orders/:id/cancel", writeLimiter, orderController.cancel);

// Payments (write operations have stricter rate limit)
app.get("/admin/orders/:id/payment", paymentController.processForm);
app.post("/admin/orders/:id/payment", writeLimiter, paymentController.process);

// --------------- ERROR HANDLING ---------------

// 404 handler
app.use((req, res) => {
  res.status(404).render("error", { message: "Page not found" });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${new Date().toISOString()} - ${err.stack}`);
  res.status(500).render("error", {
    message: process.env.NODE_ENV === "production"
      ? "Something went wrong. Please try again later."
      : err.message
  });
});

// --------------- SERVER START ---------------

const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, () => {
  console.log(`[Supplier Service] Running on port ${PORT} | ENV: ${process.env.NODE_ENV || "development"}`);
});

// --------------- GRACEFUL SHUTDOWN ---------------

const pool = require("./app/config/db");

function shutdown(signal) {
  console.log(`[Supplier Service] ${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log("[Supplier Service] HTTP server closed.");
    pool.end(() => {
      console.log("[Supplier Service] Database pool closed.");
      process.exit(0);
    });
  });
  // Force exit after 10 seconds
  setTimeout(() => {
    console.error("[Supplier Service] Forced shutdown after timeout.");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
