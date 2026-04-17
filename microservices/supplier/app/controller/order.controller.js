const Order = require("../models/order.model");

exports.findAll = (req, res) => {
  Order.getAll((err, data) => {
    if (err) { res.status(500).render("error", { message: "Error retrieving orders" }); return; }
    res.render("order-list", { orders: data });
  });
};

exports.findOne = (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id) || id < 1) {
    return res.status(400).render("error", { message: "Invalid order ID" });
  }
  Order.findById(id, (err, data) => {
    if (err) { res.status(404).render("error", { message: "Order not found" }); return; }
    res.render("order-detail", { order: data });
  });
};

exports.confirm = (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id) || id < 1) {
    return res.status(400).render("error", { message: "Invalid order ID" });
  }
  Order.confirm(id, (err) => {
    if (err) { res.status(500).render("error", { message: "Cannot confirm order" }); return; }
    res.redirect("/admin/orders/" + id);
  });
};

exports.cancel = (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id) || id < 1) {
    return res.status(400).render("error", { message: "Invalid order ID" });
  }
  Order.cancel(id, (err, data) => {
    if (err) { res.status(500).render("error", { message: "Cannot cancel order" }); return; }
    res.redirect("/admin/orders/" + id);
  });
};
