const Product = require("../models/product.model");

exports.findAll = (req, res) => {
  Product.getAll((err, data) => {
    if (err) { res.status(500).render("error", { message: "Error retrieving products" }); return; }
    res.render("product-list", { products: data });
  });
};

exports.createForm = (req, res) => {
  res.render("product-add");
};

exports.create = (req, res) => {
  // Input validation
  const name = (req.body.name || "").trim().replace(/<[^>]*>/g, "");
  const price = parseFloat(req.body.price);

  if (!name || name.length < 2 || name.length > 255) {
    return res.status(400).render("error", { message: "Product name must be 2-255 characters" });
  }
  if (isNaN(price) || price < 0 || price > 999999.99) {
    return res.status(400).render("error", { message: "Price must be between 0 and 999,999.99" });
  }

  const stock = parseInt(req.body.stock) || 0;
  if (stock < 0 || stock > 1000000) {
    return res.status(400).render("error", { message: "Stock must be between 0 and 1,000,000" });
  }

  const newProduct = {
    supplier_id: parseInt(req.body.supplier_id) || 1,
    name: name,
    description: (req.body.description || "").replace(/<[^>]*>/g, "").substring(0, 2000),
    price: price,
    stock: stock,
    category: (req.body.category || "").replace(/<[^>]*>/g, "").substring(0, 100)
  };
  Product.create(newProduct, (err, data) => {
    if (err) { res.status(500).render("error", { message: "Error creating product" }); return; }
    res.redirect("/admin/products");
  });
};

exports.editForm = (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id) || id < 1) {
    return res.status(400).render("error", { message: "Invalid product ID" });
  }
  Product.findById(id, (err, data) => {
    if (err) { res.status(404).render("error", { message: "Product not found" }); return; }
    res.render("product-update", { product: data });
  });
};

exports.update = (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id) || id < 1) {
    return res.status(400).render("error", { message: "Invalid product ID" });
  }

  const name = (req.body.name || "").trim().replace(/<[^>]*>/g, "");
  const price = parseFloat(req.body.price);
  const stock = parseInt(req.body.stock);

  if (!name || name.length < 2) {
    return res.status(400).render("error", { message: "Product name is required" });
  }
  if (isNaN(price) || price < 0) {
    return res.status(400).render("error", { message: "Valid price is required" });
  }

  Product.updateById(id, {
    name: name,
    description: (req.body.description || "").replace(/<[^>]*>/g, "").substring(0, 2000),
    price: price,
    stock: isNaN(stock) ? 0 : stock,
    category: (req.body.category || "").replace(/<[^>]*>/g, "").substring(0, 100)
  }, (err) => {
    if (err) { res.status(500).render("error", { message: "Error updating product" }); return; }
    res.redirect("/admin/products");
  });
};

exports.remove = (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id) || id < 1) {
    return res.status(400).render("error", { message: "Invalid product ID" });
  }
  Product.remove(id, (err) => {
    if (err) { res.status(500).render("error", { message: "Error deleting product" }); return; }
    res.redirect("/admin/products");
  });
};
