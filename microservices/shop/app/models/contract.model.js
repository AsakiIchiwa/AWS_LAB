const pool = require("../config/db");

const Contract = {};

Contract.findByShopId = (shopId, result) => {
  pool.query(
    `SELECT c.*, p.name AS product_name, p.image_url, u.full_name AS supplier_name, o.order_id
     FROM contracts c
     JOIN products p ON c.product_id = p.id
     JOIN users u ON c.supplier_id = u.id
     LEFT JOIN (
       SELECT contract_id, MIN(id) AS order_id
       FROM orders
       GROUP BY contract_id
     ) o ON o.contract_id = c.id
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
    `SELECT c.*, p.name AS product_name, p.image_url, p.description AS product_desc,
     u.full_name AS supplier_name, s.full_name AS shop_name, o.order_id
     FROM contracts c
     JOIN products p ON c.product_id = p.id
     JOIN users u ON c.supplier_id = u.id
     JOIN users s ON c.shop_id = s.id
     LEFT JOIN (
       SELECT contract_id, MIN(id) AS order_id
       FROM orders
       GROUP BY contract_id
     ) o ON o.contract_id = c.id
     WHERE c.id = ? AND c.shop_id = ?`,
    [id, shopId],
    (err, res) => {
      if (err) { result(err, null); return; }
      if (res.length) { result(null, res[0]); return; }
      result({ kind: "not_found" }, null);
    }
  );
};

Contract.createOrder = (contractId, shopId, result) => {
  pool.getConnection((err, connection) => {
    if (err) { result(err, null); return; }

    connection.beginTransaction((txErr) => {
      if (txErr) { connection.release(); result(txErr, null); return; }

      connection.query(
        "SELECT * FROM contracts WHERE id = ? AND shop_id = ? AND status = 'confirmed'",
        [contractId, shopId],
        (contractErr, contractRows) => {
          if (contractErr) { connection.rollback(() => connection.release()); result(contractErr, null); return; }
          if (!contractRows.length) { connection.rollback(() => connection.release()); result({ kind: "not_confirmed" }, null); return; }

          const contract = contractRows[0];

          connection.query(
            "SELECT id FROM orders WHERE contract_id = ? LIMIT 1",
            [contractId],
            (existingErr, existingRows) => {
              if (existingErr) { connection.rollback(() => connection.release()); result(existingErr, null); return; }
              if (existingRows.length) {
                connection.rollback(() => connection.release());
                result({ kind: "already_ordered", order_id: existingRows[0].id }, null);
                return;
              }

              connection.query(
                "SELECT stock FROM products WHERE id = ? FOR UPDATE",
                [contract.product_id],
                (stockErr, stockRows) => {
                  if (stockErr) { connection.rollback(() => connection.release()); result(stockErr, null); return; }
                  if (!stockRows.length || stockRows[0].stock < contract.quantity) {
                    connection.rollback(() => connection.release());
                    result({ kind: "insufficient_stock", available: stockRows.length ? stockRows[0].stock : 0 }, null);
                    return;
                  }

                  connection.query(
                    "INSERT INTO orders (contract_id, shop_id, product_id, quantity, total_price, status) VALUES (?, ?, ?, ?, ?, 'pending')",
                    [contractId, contract.shop_id, contract.product_id, contract.quantity, contract.total_amount],
                    (orderErr, orderRes) => {
                      if (orderErr) { connection.rollback(() => connection.release()); result(orderErr, null); return; }

                      connection.query(
                        "UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?",
                        [contract.quantity, contract.product_id, contract.quantity],
                        (updateErr, updateRes) => {
                          if (updateErr) { connection.rollback(() => connection.release()); result(updateErr, null); return; }
                          if (updateRes.affectedRows === 0) {
                            connection.rollback(() => connection.release());
                            result({ kind: "insufficient_stock", available: 0 }, null);
                            return;
                          }

                          connection.commit((commitErr) => {
                            if (commitErr) { connection.rollback(() => connection.release()); result(commitErr, null); return; }
                            connection.release();
                            result(null, { order_id: orderRes.insertId });
                          });
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  });
};

module.exports = Contract;
