const express = require("express");
const path = require("path");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const app = express();

// --------------- SECURITY ---------------

// HTTP security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" } // allow loading S3 images
}));

// CORS
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS || "*",
  methods: ["GET", "POST"]
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests from this IP, please try again later."
});
app.use(limiter);

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: "Too many write operations. Please wait a moment."
});

// --------------- PERFORMANCE ---------------

app.use(compression());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// --------------- APP CONFIG ---------------

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.static(path.join(__dirname, "public"), {
  maxAge: process.env.NODE_ENV === "production" ? "1d" : 0
}));

app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.json({ limit: "10mb" }));

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

// Products - full CRUD (create/update are arrays with multer middleware)
app.get("/admin/products", productController.findAll);
app.get("/admin/products/add", productController.createForm);
app.post("/admin/products", productController.create);
app.get("/admin/products/edit/:id", productController.editForm);
app.post("/admin/products/update/:id", productController.update);
app.post("/admin/products/delete/:id", writeLimiter, productController.remove);

// Orders
app.get("/admin/orders", orderController.findAll);
app.get("/admin/orders/:id", orderController.findOne);
app.post("/admin/orders/:id/confirm", writeLimiter, orderController.confirm);
app.post("/admin/orders/:id/cancel", writeLimiter, orderController.cancel);

// Payments
app.get("/admin/orders/:id/payment", paymentController.processForm);
app.post("/admin/orders/:id/payment", writeLimiter, paymentController.process);

// --------------- ERROR HANDLING ---------------

app.use((req, res) => {
  res.status(404).render("error", { message: "Page not found" });
});

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
  setTimeout(() => {
    console.error("[Supplier Service] Forced shutdown after timeout.");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
