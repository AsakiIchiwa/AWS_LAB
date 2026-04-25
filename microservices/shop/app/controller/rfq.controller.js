const RFQ = require("../models/rfq.model");
const Product = require("../models/product.model");

exports.findAll = (req, res) => {
  const shopId = req.session.user.id;
  RFQ.findByShopId(shopId, (err, data) => {
    if (err) return res.status(500).render("error", { message: "Error retrieving RFQs" });
    res.render("rfq-list", { rfqs: data });
  });
};

exports.findOne = (req, res) => {
  const id = parseInt(req.params.id, 10);
  const shopId = req.session.user.id;
  if (isNaN(id) || id < 1) return res.status(400).render("error", { message: "Invalid RFQ ID" });

  RFQ.findById(id, shopId, (err, data) => {
    if (err) {
      if (err.kind === "not_found") return res.status(404).render("error", { message: "RFQ not found" });
      return res.status(500).render("error", { message: "Error retrieving RFQ" });
    }
    res.render("rfq-detail", { rfq: data });
  });
};

exports.createForm = (req, res) => {
  const productId = parseInt(req.params.productId, 10);
  if (isNaN(productId) || productId < 1) return res.status(400).render("error", { message: "Invalid product ID" });

  Product.findById(productId, (err, data) => {
    if (err || !data || data.status !== "active") {
      return res.status(404).render("error", { message: "Product not found or inactive" });
    }
    res.render("rfq-create", { product: data });
  });
};

exports.create = (req, res) => {
  const quantity = parseInt(req.body.quantity, 10);
  const productId = parseInt(req.body.product_id, 10);
  const shopId = req.session.user.id;

  if (isNaN(quantity) || isNaN(productId)) {
    return res.status(400).render("error", { message: "Valid quantity and product are required" });
  }
  if (quantity < 1 || quantity > 100000) {
    return res.status(400).render("error", { message: "Quantity must be between 1 and 100,000" });
  }

  const note = (req.body.note || "").replace(/<[^>]*>/g, "").substring(0, 500);

  Product.findById(productId, (productErr, product) => {
    if (productErr || !product || product.status !== "active") {
      return res.status(404).render("error", { message: "Product not found or inactive" });
    }

    RFQ.create({ shop_id: shopId, product_id: productId, quantity, note }, (err, data) => {
      if (err) {
        if (err.kind === "invalid_product") {
          return res.status(400).render("error", { message: "Invalid product or supplier mapping" });
        }
        return res.status(500).render("error", { message: "Error creating RFQ" });
      }
      res.redirect("/rfqs/" + data.id);
    });
  });
};

exports.acceptQuote = (req, res) => {
  const rfqId = parseInt(req.params.id, 10);
  const quoteId = parseInt(req.params.quoteId, 10);
  const shopId = req.session.user.id;
  if (isNaN(rfqId) || isNaN(quoteId)) return res.status(400).render("error", { message: "Invalid IDs" });

  RFQ.acceptQuote(rfqId, quoteId, shopId, (err, data) => {
    if (err) {
      if (err.kind === "not_found") return res.status(404).render("error", { message: "Quote not found" });
      if (err.kind === "invalid_state") return res.status(409).render("error", { message: "Quote is no longer available for acceptance" });
      if (err.kind === "insufficient_stock") return res.status(409).render("error", { message: `Insufficient stock. Available: ${err.available}` });
      return res.status(500).render("error", { message: "Error accepting quote" });
    }
    res.redirect("/orders/" + data.order_id);
  });
};

exports.rejectQuote = (req, res) => {
  const rfqId = parseInt(req.params.id, 10);
  const quoteId = parseInt(req.params.quoteId, 10);
  const shopId = req.session.user.id;
  if (isNaN(rfqId) || isNaN(quoteId)) return res.status(400).render("error", { message: "Invalid IDs" });

  RFQ.rejectQuote(rfqId, quoteId, shopId, (err) => {
    if (err) {
      if (err.kind === "not_found") return res.status(404).render("error", { message: "Quote not found or no longer pending" });
      return res.status(500).render("error", { message: "Error rejecting quote" });
    }
    res.redirect("/rfqs/" + rfqId);
  });
};
