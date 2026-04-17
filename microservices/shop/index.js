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

// Stricter rate limit for order creation (prevent spam)
const orderLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // max 10 orders per minute per IP
  message: "Too many orders submitted. Please wait a moment."
});

// --------------- PERFORMANCE ---------------

// Gzip compression for responses
app.use(compression());

// Request logging (combined format for production, dev for local)
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
    service: "shop",
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// --------------- ROUTES ---------------

const productController = require("./app/controller/product.controller");
const orderController = require("./app/controller/order.controller");

// Home
app.get("/", (req, res) => {
  res.render("home");
});

// Products - read only
app.get("/products", productController.findAll);
app.get("/products/:id", productController.findOne);

// Orders - create + read (with stricter rate limit on POST)
app.get("/orders", orderController.findAll);
app.get("/orders/new/:productId", orderController.createForm);
app.post("/orders", orderLimiter, orderController.create);
app.get("/orders/:id", orderController.findOne);

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
  console.log(`[Shop Service] Running on port ${PORT} | ENV: ${process.env.NODE_ENV || "development"}`);
});

// --------------- GRACEFUL SHUTDOWN ---------------

const pool = require("./app/config/db");

function shutdown(signal) {
  console.log(`[Shop Service] ${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log("[Shop Service] HTTP server closed.");
    pool.end(() => {
      console.log("[Shop Service] Database pool closed.");
      process.exit(0);
    });
  });
  // Force exit after 10 seconds
  setTimeout(() => {
    console.error("[Shop Service] Forced shutdown after timeout.");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
