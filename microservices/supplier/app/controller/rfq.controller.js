const RFQ = require("../models/rfq.model");

exports.findAll = (req, res) => {
  const supplierId = req.session.user.id;
  RFQ.findBySupplierId(supplierId, (err, data) => {
    if (err) return res.status(500).render("error", { message: "Error retrieving RFQs" });
    res.render("rfq-list", { rfqs: data });
  });
};

exports.findOne = (req, res) => {
  const id = parseInt(req.params.id, 10);
  const supplierId = req.session.user.id;
  if (isNaN(id) || id < 1) return res.status(400).render("error", { message: "Invalid RFQ ID" });

  RFQ.findById(id, supplierId, (err, data) => {
    if (err) {
      if (err.kind === "not_found") return res.status(404).render("error", { message: "RFQ not found" });
      return res.status(500).render("error", { message: "Error retrieving RFQ" });
    }
    res.render("rfq-detail", { rfq: data });
  });
};

exports.submitQuote = (req, res) => {
  const rfqId = parseInt(req.params.id, 10);
  if (isNaN(rfqId) || rfqId < 1) return res.status(400).render("error", { message: "Invalid RFQ ID" });

  const unitPrice = parseFloat(req.body.unit_price);
  const moq = parseInt(req.body.moq, 10) || 1;
  const deliveryDays = parseInt(req.body.delivery_days, 10) || 7;
  const supplierId = req.session.user.id;

  if (isNaN(unitPrice) || unitPrice <= 0) return res.status(400).render("error", { message: "Valid unit price is required" });
  if (moq < 1) return res.status(400).render("error", { message: "MOQ must be at least 1" });
  if (deliveryDays < 1) return res.status(400).render("error", { message: "Delivery days must be at least 1" });

  const note = (req.body.note || "").replace(/<[^>]*>/g, "").substring(0, 500);

  RFQ.submitQuote(rfqId, {
    supplier_id: supplierId,
    unit_price: unitPrice,
    moq,
    delivery_days: deliveryDays,
    note
  }, (err) => {
    if (err) {
      if (err.kind === "not_found") return res.status(404).render("error", { message: "RFQ not found or not yours" });
      if (err.kind === "rfq_closed") return res.status(409).render("error", { message: "RFQ is already closed" });
      if (err.kind === "quote_finalized") return res.status(409).render("error", { message: "Quote can no longer be edited" });
      return res.status(500).render("error", { message: "Error submitting quote" });
    }
    res.redirect("/admin/rfqs/" + rfqId);
  });
};

exports.reject = (req, res) => {
  const rfqId = parseInt(req.params.id, 10);
  const supplierId = req.session.user.id;
  if (isNaN(rfqId) || rfqId < 1) return res.status(400).render("error", { message: "Invalid RFQ ID" });

  RFQ.reject(rfqId, supplierId, (err) => {
    if (err) {
      if (err.kind === "not_found") return res.status(404).render("error", { message: "RFQ not found or not yours" });
      if (err.kind === "invalid_status") return res.status(409).render("error", { message: "RFQ can no longer be rejected" });
      return res.status(500).render("error", { message: "Error rejecting RFQ" });
    }
    res.redirect("/admin/rfqs/" + rfqId);
  });
};
