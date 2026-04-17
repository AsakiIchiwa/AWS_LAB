const Payment = require("../models/payment.model");

const VALID_METHODS = ["bank_transfer", "qr_code", "cod"];

exports.processForm = (req, res) => {
  const orderId = parseInt(req.params.id);
  if (isNaN(orderId) || orderId < 1) {
    return res.status(400).render("error", { message: "Invalid order ID" });
  }
  res.render("payment-process", { order_id: orderId });
};

exports.process = (req, res) => {
  const orderId = parseInt(req.params.id);
  if (isNaN(orderId) || orderId < 1) {
    return res.status(400).render("error", { message: "Invalid order ID" });
  }

  const method = req.body.method || "bank_transfer";
  if (!VALID_METHODS.includes(method)) {
    return res.status(400).render("error", { message: "Invalid payment method" });
  }

  Payment.process(orderId, method, (err, data) => {
    if (err) {
      if (err.kind === "order_not_confirmed") {
        return res.render("error", { message: "Order must be confirmed before payment" });
      }
      if (err.kind === "payment_failed") {
        return res.render("error", { message: "Payment failed. Order cancelled and stock restored. Reason: " + err.message });
      }
      return res.status(500).render("error", { message: "Error processing payment" });
    }
    res.redirect("/admin/orders/" + orderId);
  });
};
