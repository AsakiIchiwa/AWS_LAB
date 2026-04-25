const pool = require("../config/db");

const Order = {};

Order.getBySupplierId = (supplierId, result) => {
  pool.query(
    "SELECT o.*, p.name as product_name, u.full_name as shop_name FROM orders o JOIN products p ON o.product_id = p.id JOIN users u ON o.shop_id = u.id WHERE p.supplier_id = ? ORDER BY o.created_at DESC",
    [supplierId],
    (err, res) => {
      if (err) { result(err, null); return; }
      result(null, res);
    }
  );
};

Order.findById = (id, supplierId, result) => {
  pool.query(
    "SELECT o.*, p.name as product_name, p.price as unit_price, u.full_name as shop_name FROM orders o JOIN products p ON o.product_id = p.id JOIN users u ON o.shop_id = u.id WHERE o.id = ? AND p.supplier_id = ?",
    [id, supplierId],
    (err, res) => {
      if (err) { result(err, null); return; }
      if (res.length) { result(null, res[0]); return; }
      result({ kind: "not_found" }, null);
    }
  );
};

Order.confirm = (id, supplierId, result) => {
  pool.query(
    "UPDATE orders o JOIN products p ON o.product_id = p.id SET o.status = 'confirmed' WHERE o.id = ? AND p.supplier_id = ? AND o.status = 'pending'",
    [id, supplierId],
    (err, res) => {
      if (err) { result(err, null); return; }
      if (res.affectedRows == 0) { result({ kind: "not_found_or_invalid_status" }, null); return; }
      result(null, { id: id, status: "confirmed" });
    }
  );
};

// Cancel order + rollback stock (Saga compensating transaction)
Order.cancel = (id, supplierId, result) => {
  // Get order details first (with supplier ownership check)
  pool.query(
    "SELECT o.* FROM orders o JOIN products p ON o.product_id = p.id WHERE o.id = ? AND p.supplier_id = ? AND o.status IN ('pending', 'confirmed')",
    [id, supplierId],
    (err, res) => {
    if (err) { result(err, null); return; }
    if (!res.length) { result({ kind: "not_found_or_invalid_status" }, null); return; }

    const order = res[0];

    pool.getConnection((err, connection) => {
      if (err) { result(err, null); return; }

      connection.beginTransaction((err) => {
        if (err) { connection.release(); result(err, null); return; }

        // Cancel order
        connection.query("UPDATE orders SET status = 'cancelled' WHERE id = ?", [id], (err) => {
          if (err) { connection.rollback(() => connection.release()); result(err, null); return; }

          // Rollback stock - compensating transaction
          connection.query("UPDATE products SET stock = stock + ? WHERE id = ?", [order.quantity, order.product_id], (err) => {
            if (err) { connection.rollback(() => connection.release()); result(err, null); return; }

            connection.commit((err) => {
              if (err) { connection.rollback(() => connection.release()); result(err, null); return; }
              connection.release();
              result(null, { id: id, status: "cancelled", restored_quantity: order.quantity });
            });
          });
        });
      });
    });
  });
};

module.exports = Order;
