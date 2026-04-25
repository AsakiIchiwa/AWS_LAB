const pool = require("../config/db");

const RFQ = {};

RFQ.findBySupplierId = (supplierId, result) => {
  pool.query(
    `SELECT r.*, p.name AS product_name, p.image_url, s.full_name AS shop_name,
            q.id AS quote_id, q.status AS quote_status, q.unit_price
     FROM rfqs r
     JOIN products p ON r.product_id = p.id
     JOIN users s ON r.shop_id = s.id
     LEFT JOIN quotes q ON q.rfq_id = r.id AND q.supplier_id = r.supplier_id
     WHERE r.supplier_id = ?
     ORDER BY r.created_at DESC`,
    [supplierId],
    (err, res) => {
      if (err) { result(err, null); return; }
      result(null, res);
    }
  );
};

RFQ.findById = (id, supplierId, result) => {
  pool.query(
    `SELECT r.*, p.name AS product_name, p.price AS list_price, p.image_url,
            s.full_name AS shop_name, u.full_name AS supplier_name,
            q.id AS quote_id, q.unit_price, q.moq, q.delivery_days, q.note AS quote_note, q.status AS quote_status
     FROM rfqs r
     JOIN products p ON r.product_id = p.id
     JOIN users s ON r.shop_id = s.id
     JOIN users u ON r.supplier_id = u.id
     LEFT JOIN quotes q ON q.rfq_id = r.id AND q.supplier_id = r.supplier_id
     WHERE r.id = ? AND r.supplier_id = ?`,
    [id, supplierId],
    (err, res) => {
      if (err) { result(err, null); return; }
      if (res.length) { result(null, res[0]); return; }
      result({ kind: "not_found" }, null);
    }
  );
};

RFQ.submitQuote = (rfqId, data, result) => {
  pool.getConnection((err, connection) => {
    if (err) { result(err, null); return; }

    connection.beginTransaction((txErr) => {
      if (txErr) { connection.release(); result(txErr, null); return; }

      connection.query(
        "SELECT id, status FROM rfqs WHERE id = ? AND supplier_id = ? FOR UPDATE",
        [rfqId, data.supplier_id],
        (rfqErr, rfqRows) => {
          if (rfqErr) { connection.rollback(() => connection.release()); result(rfqErr, null); return; }
          if (!rfqRows.length) {
            connection.rollback(() => connection.release());
            result({ kind: "not_found" }, null);
            return;
          }

          const rfqStatus = rfqRows[0].status;
          if (rfqStatus === "accepted" || rfqStatus === "rejected" || rfqStatus === "expired") {
            connection.rollback(() => connection.release());
            result({ kind: "rfq_closed" }, null);
            return;
          }

          connection.query(
            "SELECT id, status FROM quotes WHERE rfq_id = ? AND supplier_id = ? FOR UPDATE",
            [rfqId, data.supplier_id],
            (quoteErr, quoteRows) => {
              if (quoteErr) { connection.rollback(() => connection.release()); result(quoteErr, null); return; }

              const finalize = (quoteId, mode) => {
                connection.query(
                  "UPDATE rfqs SET status = 'quoted' WHERE id = ? AND supplier_id = ?",
                  [rfqId, data.supplier_id],
                  (updateRfqErr) => {
                    if (updateRfqErr) { connection.rollback(() => connection.release()); result(updateRfqErr, null); return; }

                    connection.commit((commitErr) => {
                      if (commitErr) { connection.rollback(() => connection.release()); result(commitErr, null); return; }
                      connection.release();
                      result(null, { id: quoteId, rfq_id: rfqId, mode });
                    });
                  }
                );
              };

              if (!quoteRows.length) {
                connection.query(
                  "INSERT INTO quotes (rfq_id, supplier_id, unit_price, moq, delivery_days, note, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')",
                  [rfqId, data.supplier_id, data.unit_price, data.moq || 1, data.delivery_days || 7, data.note || ""],
                  (insertErr, insertRes) => {
                    if (insertErr) { connection.rollback(() => connection.release()); result(insertErr, null); return; }
                    finalize(insertRes.insertId, "created");
                  }
                );
                return;
              }

              const quote = quoteRows[0];
              if (quote.status !== "pending") {
                connection.rollback(() => connection.release());
                result({ kind: "quote_finalized" }, null);
                return;
              }

              connection.query(
                "UPDATE quotes SET unit_price = ?, moq = ?, delivery_days = ?, note = ?, status = 'pending' WHERE id = ?",
                [data.unit_price, data.moq || 1, data.delivery_days || 7, data.note || "", quote.id],
                (updateQuoteErr) => {
                  if (updateQuoteErr) { connection.rollback(() => connection.release()); result(updateQuoteErr, null); return; }
                  finalize(quote.id, "updated");
                }
              );
            }
          );
        }
      );
    });
  });
};

RFQ.reject = (rfqId, supplierId, result) => {
  pool.getConnection((err, connection) => {
    if (err) { result(err, null); return; }

    connection.beginTransaction((txErr) => {
      if (txErr) { connection.release(); result(txErr, null); return; }

      connection.query(
        "SELECT status FROM rfqs WHERE id = ? AND supplier_id = ? FOR UPDATE",
        [rfqId, supplierId],
        (checkErr, rows) => {
          if (checkErr) { connection.rollback(() => connection.release()); result(checkErr, null); return; }
          if (!rows.length) {
            connection.rollback(() => connection.release());
            result({ kind: "not_found" }, null);
            return;
          }

          const status = rows[0].status;
          if (status === "accepted" || status === "rejected" || status === "expired") {
            connection.rollback(() => connection.release());
            result({ kind: "invalid_status" }, null);
            return;
          }

          connection.query(
            "UPDATE quotes SET status = 'rejected' WHERE rfq_id = ? AND supplier_id = ? AND status = 'pending'",
            [rfqId, supplierId],
            (quoteErr) => {
              if (quoteErr) { connection.rollback(() => connection.release()); result(quoteErr, null); return; }

              connection.query(
                "UPDATE rfqs SET status = 'rejected' WHERE id = ? AND supplier_id = ?",
                [rfqId, supplierId],
                (rfqErr, rfqRes) => {
                  if (rfqErr) { connection.rollback(() => connection.release()); result(rfqErr, null); return; }
                  if (rfqRes.affectedRows === 0) {
                    connection.rollback(() => connection.release());
                    result({ kind: "invalid_status" }, null);
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
