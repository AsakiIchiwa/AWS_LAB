const Product = require("../models/product.model");

exports.findAll = (req, res) => {
  // Sanitize search input
  const keyword = (req.query.search || "").replace(/<[^>]*>/g, "").substring(0, 100);
  const handler = (err, data) => {
    if (err) { res.status(500).render("error", { message: "Error retrieving products." }); return; }
    res.render("product-list", { products: data, keyword: keyword });
  };
  if (keyword) {
    Product.search(keyword, handler);
  } else {
    Product.getAll(handler);
  }
};

exports.findOne = (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id) || id < 1) {
    return res.status(400).render("error", { message: "Invalid product ID" });
  }
  Product.findById(id, (err, data) => {
    if (err) {
      if (err.kind === "not_found") { res.status(404).render("error", { message: "Product not found" }); return; }
      res.status(500).render("error", { message: "Error retrieving product" }); return;
    }
    res.render("product-detail", { product: data });
  });
};
