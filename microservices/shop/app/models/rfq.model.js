const pool = require("../config/db");

const RFQ = {};

RFQ.create = (data, result) => {
  pool.query(
    `INSERT INTO rfqs (shop_id, supplier_id, product_id, quantity, note)
     SELECT ?, p.supplier_id, p.id, ?, ?
     FROM products p
     JOIN users u ON u.id = p.supplier_id
     WHERE p.id = ? AND p.status = 'active' AND u.role = 'supplier' AND u.status = 'approved'`,
    [data.shop_id, data.quantity, data.note || "", data.product_id],
    (err, res) => {
      if (err) { result(err, null); return; }
      if (res.affectedRows === 0) {
        result({ kind: "invalid_product" }, null);
        return;
      }
      result(null, { id: res.insertId, status: "pending" });
    }
  );
};

RFQ.findByShopId = (shopId, result) => {
  pool.query(
    `SELECT r.*, p.name AS product_name, p.image_url, u.full_name AS supplier_name,
     q.unit_price AS quoted_price, q.moq, q.delivery_days, q.id AS quote_id, q.status AS quote_status
     FROM rfqs r
     JOIN products p ON r.product_id = p.id
     JOIN users u ON r.supplier_id = u.id
     LEFT JOIN quotes q ON q.rfq_id = r.id AND q.supplier_id = r.supplier_id
     WHERE r.shop_id = ?
     ORDER BY r.created_at DESC`,
    [shopId],
    (err, res) => {
      if (err) { result(err, null); return; }
      result(null, res);
    }
  );
};

RFQ.findById = (id, shopId, result) => {
  pool.query(
    `SELECT r.*, p.name AS product_name, p.price AS list_price, p.image_url, p.description AS product_desc,
     u.full_name AS supplier_name, s.full_name AS shop_name,
     q.id AS quote_id, q.unit_price AS quoted_price, q.moq, q.delivery_days, q.note AS quote_note, q.status AS quote_status
     FROM rfqs r
     JOIN products p ON r.product_id = p.id
     JOIN users u ON r.supplier_id = u.id
     JOIN users s ON r.shop_id = s.id
     LEFT JOIN quotes q ON q.rfq_id = r.id AND q.supplier_id = r.supplier_id
     WHERE r.id = ? AND r.shop_id = ?`,
    [id, shopId],
    (err, res) => {
      if (err) { result(err, null); return; }
      if (res.length) { result(null, res[0]); return; }
      result({ kind: "not_found" }, null);
    }
  );
};

RFQ.acceptQuote = (rfqId, quoteId, shopId, result) => {
  pool.getConnection((err, connection) => {
    if (err) { result(err, null); return; }

    connection.beginTransaction((txErr) => {
      if (txErr) { connection.release(); result(txErr, null); return; }

      connection.query(
        `SELECT q.id AS quote_id, q.supplier_id, q.unit_price, q.delivery_days, q.status AS quote_status,
                r.id AS rfq_id, r.shop_id, r.product_id, r.quantity, r.status AS rfq_status
         FROM quotes q
         JOIN rfqs r ON q.rfq_id = r.id
         WHERE q.id = ? AND q.rfq_id = ? AND r.shop_id = ?
         FOR UPDATE`,
        [quoteId, rfqId, shopId],
        (quoteErr, quoteRows) => {
          if (quoteErr) { connection.rollback(() => connection.release()); result(quoteErr, null); return; }
          if (!quoteRows.length) { connection.rollback(() => connection.release()); result({ kind: "not_found" }, null); return; }

          const quote = quoteRows[0];
          if (quote.quote_status !== "pending" || quote.rfq_status !== "quoted") {
            connection.rollback(() => connection.release());
            result({ kind: "invalid_state" }, null);
            return;
          }

          connection.query(
            "SELECT stock FROM products WHERE id = ? AND status = 'active' FOR UPDATE",
            [quote.product_id],
            (stockErr, stockRows) => {
              if (stockErr) { connection.rollback(() => connection.release()); result(stockErr, null); return; }
              if (!stockRows.length || stockRows[0].stock < quote.quantity) {
                connection.rollback(() => connection.release());
                result({ kind: "insufficient_stock", available: stockRows.length ? stockRows[0].stock : 0 }, null);
                return;
              }

              const totalAmount = quote.unit_price * quote.quantity;

              connection.query(
                "UPDATE quotes SET status = 'accepted' WHERE id = ? AND status = 'pending'",
                [quoteId],
                (updateQuoteErr, updateQuoteRes) => {
                  if (updateQuoteErr) { connection.rollback(() => connection.release()); result(updateQuoteErr, null); return; }
                  if (updateQuoteRes.affectedRows === 0) {
                    connection.rollback(() => connection.release());
                    result({ kind: "invalid_state" }, null);
                    return;
                  }

                  connection.query(
                    "UPDATE rfqs SET status = 'accepted' WHERE id = ? AND shop_id = ? AND status = 'quoted'",
                    [rfqId, shopId],
                    (updateRfqErr, updateRfqRes) => {
                      if (updateRfqErr) { connection.rollback(() => connection.release()); result(updateRfqErr, null); return; }
                      if (updateRfqRes.affectedRows === 0) {
                        connection.rollback(() => connection.release());
                        result({ kind: "invalid_state" }, null);
                        return;
                      }

                      connection.query(
                        `INSERT INTO contracts (quote_id, shop_id, supplier_id, product_id, quantity, unit_price, total_amount, delivery_days, status)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`,
                        [quoteId, quote.shop_id, quote.supplier_id, quote.product_id, quote.quantity, quote.unit_price, totalAmount, quote.delivery_days],
                        (contractErr, contractRes) => {
                          if (contractErr) { connection.rollback(() => connection.release()); result(contractErr, null); return; }

                          connection.query(
                            `INSERT INTO orders (contract_id, shop_id, product_id, quantity, total_price, status, note)
                             VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
                            [contractRes.insertId, quote.shop_id, quote.product_id, quote.quantity, totalAmount, `Created from accepted quote #${quoteId}`],
                            (orderErr, orderRes) => {
                              if (orderErr) { connection.rollback(() => connection.release()); result(orderErr, null); return; }

                              connection.query(
                                "UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?",
                                [quote.quantity, quote.product_id, quote.quantity],
                                (stockUpdateErr, stockUpdateRes) => {
                                  if (stockUpdateErr) { connection.rollback(() => connection.release()); result(stockUpdateErr, null); return; }
                                  if (stockUpdateRes.affectedRows === 0) {
                                    connection.rollback(() => connection.release());
                                    result({ kind: "insufficient_stock", available: 0 }, null);
                                    return;
                                  }

                                  connection.commit((commitErr) => {
                                    if (commitErr) { connection.rollback(() => connection.release()); result(commitErr, null); return; }
                                    connection.release();
                                    result(null, {
                                      contract_id: contractRes.insertId,
                                      order_id: orderRes.insertId,
                                      total_amount: totalAmount
                                    });
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
            }
          );
        }
      );
    });
  });
};

RFQ.rejectQuote = (rfqId, quoteId, shopId, result) => {
  pool.getConnection((err, connection) => {
    if (err) { result(err, null); return; }

    connection.beginTransaction((txErr) => {
      if (txErr) { connection.release(); result(txErr, null); return; }

      connection.query(
        `SELECT q.id
         FROM quotes q
         JOIN rfqs r ON q.rfq_id = r.id
         WHERE q.id = ? AND q.rfq_id = ? AND r.shop_id = ?
           AND q.status = 'pending' AND r.status = 'quoted'
         FOR UPDATE`,
        [quoteId, rfqId, shopId],
        (checkErr, checkRows) => {
          if (checkErr) { connection.rollback(() => connection.release()); result(checkErr, null); return; }
          if (!checkRows.length) {
            connection.rollback(() => connection.release());
            result({ kind: "not_found" }, null);
            return;
          }

          connection.query(
            "UPDATE quotes SET status = 'rejected' WHERE id = ? AND status = 'pending'",
            [quoteId],
            (quoteErr, quoteRes) => {
              if (quoteErr) { connection.rollback(() => connection.release()); result(quoteErr, null); return; }
              if (quoteRes.affectedRows === 0) {
                connection.rollback(() => connection.release());
                result({ kind: "not_found" }, null);
                return;
              }

              connection.query(
                "UPDATE rfqs SET status = 'rejected' WHERE id = ? AND shop_id = ? AND status = 'quoted'",
                [rfqId, shopId],
                (rfqErr, rfqRes) => {
                  if (rfqErr) { connection.rollback(() => connection.release()); result(rfqErr, null); return; }
                  if (rfqRes.affectedRows === 0) {
                    connection.rollback(() => connection.release());
                    result({ kind: "not_found" }, null);
                    return;
                  }

                  connection.commit((commitErr) => {
                    if (commitErr) { connection.rollback(() => connection.release()); result(commitErr, null); return; }
                    connection.release();
                    result(null, { id: rfqId, status: "rejected" });
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

module.exports = RFQ;
