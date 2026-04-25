const pool = require("../config/db");

const Product = {};

Product.getAll = (supplierId, result) => {
  pool.query("SELECT p.*, u.full_name as supplier_name FROM products p JOIN users u ON p.supplier_id = u.id WHERE p.supplier_id = ? ORDER BY p.created_at DESC", [supplierId], (err, res) => {
    if (err) { result(err, null); return; }
    result(null, res);
  });
};

Product.findById = (id, supplierId, result) => {
  pool.query("SELECT * FROM products WHERE id = ? AND supplier_id = ?", [id, supplierId], (err, res) => {
    if (err) { result(err, null); return; }
    if (res.length) { result(null, res[0]); return; }
    result({ kind: "not_found" }, null);
  });
};

Product.create = (newProduct, result) => {
  pool.query("INSERT INTO products (supplier_id, name, description, price, stock, status, category, image_url) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)",
    [newProduct.supplier_id, newProduct.name, newProduct.description, newProduct.price, newProduct.stock, newProduct.category, newProduct.image_url || null],
    (err, res) => {
      if (err) { result(err, null); return; }
      result(null, { id: res.insertId, ...newProduct });
    }
  );
};

Product.updateById = (id, supplierId, product, result) => {
  pool.query("UPDATE products SET name = ?, description = ?, price = ?, stock = ?, category = ?, image_url = ? WHERE id = ? AND supplier_id = ?",
    [product.name, product.description, product.price, product.stock, product.category, product.image_url || null, id, supplierId],
    (err, res) => {
      if (err) { result(err, null); return; }
      if (res.affectedRows == 0) { result({ kind: "not_found" }, null); return; }
      result(null, { id: id, ...product });
    }
  );
};

Product.remove = (id, supplierId, result) => {
  pool.query("DELETE FROM products WHERE id = ? AND supplier_id = ?", [id, supplierId], (err, res) => {
    if (err) { result(err, null); return; }
    if (res.affectedRows == 0) { result({ kind: "not_found" }, null); return; }
    result(null, res);
  });
};

module.exports = Product;
