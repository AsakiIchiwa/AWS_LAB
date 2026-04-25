const pool = require("../config/db");

const Order = {};

// Create order + reduce stock (Saga step 1) — stock check inside transaction with row lock
Order.create = (newOrder, result) => {
  pool.getConnection((err, connection) => {
    if (err) { result(err, null); return; }

    connection.beginTransaction((err) => {
      if (err) { connection.release(); result(err, null); return; }

      // Lock the product row and check stock inside the transaction
      connection.query(
        "SELECT stock, price FROM products WHERE id = ? AND status = 'active' FOR UPDATE",
        [newOrder.product_id],
        (err, res) => {
          if (err) { connection.rollback(() => connection.release()); result(err, null); return; }
          if (!res.length) { connection.rollback(() => connection.release()); result({ kind: "product_not_found" }, null); return; }

          const product = res[0];
          if (product.stock < newOrder.quantity) {
            connection.rollback(() => connection.release());
            result({ kind: "insufficient_stock", available: product.stock }, null);
            return;
          }

          const totalPrice = product.price * newOrder.quantity;

          // Insert order
          connection.query(
            "INSERT INTO orders (shop_id, product_id, quantity, total_price, status, note) VALUES (?, ?, ?, ?, 'pending', ?)",
            [newOrder.shop_id, newOrder.product_id, newOrder.quantity, totalPrice, newOrder.note || ""],
            (err, res) => {
              if (err) { connection.rollback(() => connection.release()); result(err, null); return; }

              const orderId = res.insertId;

              // Reduce stock with conditional check
              connection.query(
                "UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?",
                [newOrder.quantity, newOrder.product_id, newOrder.quantity],
                (err, updateRes) => {
                  if (err) { connection.rollback(() => connection.release()); result(err, null); return; }
                  if (updateRes.affectedRows === 0) {
                    connection.rollback(() => connection.release());
                    result({ kind: "insufficient_stock", available: product.stock }, null);
                    return;
                  }

                  connection.commit((err) => {
                    if (err) { connection.rollback(() => connection.release()); result(err, null); return; }
                    connection.release();
                    result(null, { id: orderId, total_price: totalPrice, status: "pending" });
                  });
                }
              );
            }
          );
        }
      );
    });
  });
};

Order.findByShopId = (shopId, result) => {
  pool.query(
    "SELECT o.*, p.name as product_name, p.image_url FROM orders o JOIN products p ON o.product_id = p.id WHERE o.shop_id = ? ORDER BY o.created_at DESC",
    [shopId],
    (err, res) => {
      if (err) { result(err, null); return; }
      result(null, res);
    }
  );
};

Order.findById = (id, shopId, result) => {
  pool.query(
    "SELECT o.*, p.name as product_name, p.price as unit_price, p.image_url, u.full_name as supplier_name FROM orders o JOIN products p ON o.product_id = p.id JOIN users u ON p.supplier_id = u.id WHERE o.id = ? AND o.shop_id = ?",
    [id, shopId],
    (err, res) => {
      if (err) { result(err, null); return; }
      if (res.length) { result(null, res[0]); return; }
      result({ kind: "not_found" }, null);
    }
  );
};

module.exports = Order;
