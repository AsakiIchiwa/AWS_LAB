const pool = require("../config/db");

const Contract = {};

Contract.findByShopId = (shopId, result) => {
  pool.query(
    `SELECT c.*, p.name as product_name, p.image_url, u.full_name as supplier_name
     FROM contracts c
     JOIN products p ON c.product_id = p.id
     JOIN users u ON c.supplier_id = u.id
     WHERE c.shop_id = ?
     ORDER BY c.created_at DESC`,
    [shopId],
    (err, res) => {
      if (err) { result(err, null); return; }
      result(null, res);
    }
  );
};

Contract.findById = (id, shopId, result) => {
  pool.query(
    `SELECT c.*, p.name as product_name, p.image_url, p.description as product_desc,
     u.full_name as supplier_name, s.full_name as shop_name
     FROM contracts c
     JOIN products p ON c.product_id = p.id
     JOIN users u ON c.supplier_id = u.id
     JOIN users s ON c.shop_id = s.id
     WHERE c.id = ? AND c.shop_id = ?`,
    [id, shopId],
    (err, res) => {
      if (err) { result(err, null); return; }
      if (res.length) { result(null, res[0]); return; }
      result({ kind: "not_found" }, null);
    }
  );
};

// Create order from contract
Contract.createOrder = (contractId, shopId, result) => {
  pool.getConnection((err, connection) => {
    if (err) { result(err, null); return; }
    connection.beginTransaction((err) => {
      if (err) { connection.release(); result(err, null); return; }

      connection.query("SELECT * FROM contracts WHERE id = ? AND shop_id = ? AND status = 'confirmed'", [contractId, shopId], (err, res) => {
        if (err) { connection.rollback(() => connection.release()); result(err, null); return; }
        if (!res.length) { connection.rollback(() => connection.release()); result({ kind: "not_confirmed" }, null); return; }

        const contract = res[0];

        // Check stock with row lock
        connection.query("SELECT stock FROM products WHERE id = ? FOR UPDATE", [contract.product_id], (err, pRes) => {
          if (err) { connection.rollback(() => connection.release()); result(err, null); return; }
          if (!pRes.length || pRes[0].stock < contract.quantity) {
            connection.rollback(() => connection.release());
            result({ kind: "insufficient_stock", available: pRes.length ? pRes[0].stock : 0 }, null);
            return;
          }

          // Create order
          connection.query(
            "INSERT INTO orders (contract_id, shop_id, product_id, quantity, total_price, status) VALUES (?, ?, ?, ?, ?, 'pending')",
            [contractId, contract.shop_id, contract.product_id, contract.quantity, contract.total_amount],
            (err, oRes) => {
              if (err) { connection.rollback(() => connection.release()); result(err, null); return; }

              // Deduct stock with conditional check
              connection.query("UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?", [contract.quantity, contract.product_id, contract.quantity], (err, updateRes) => {
                if (err) { connection.rollback(() => connection.release()); result(err, null); return; }
                if (updateRes.affectedRows === 0) {
                  connection.rollback(() => connection.release());
                  result({ kind: "insufficient_stock", available: 0 }, null);
                  return;
                }

                connection.commit((err) => {
                  if (err) { connection.rollback(() => connection.release()); result(err, null); return; }
                  connection.release();
                  result(null, { order_id: oRes.insertId });
                });
              });
            }
          );
        });
      });
    });
  });
};

module.exports = Contract;
