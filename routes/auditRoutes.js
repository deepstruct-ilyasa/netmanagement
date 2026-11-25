const express = require('express');
const multer = require('multer');
const path = require('path');
const router = express.Router();
const auditController = require('../controllers/auditController');
const { requireAdmin, requireMenu } = require('../middlewares/authMiddleware');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'public', 'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '.jpg').toLowerCase();
    cb(null, `AUDIT_UNREG_${Date.now()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });

// Daftar & Detail Audit (Wajib Administrator atau User yang pernah ditugaskan audit)
router.get('/audits', requireMenu('asset-audits'), auditController.listAudits);
router.get('/audits/:id', requireMenu('asset-audits'), auditController.detailAudit);
router.get('/audits/:id/export', requireMenu('asset-audits'), auditController.exportAuditCsv);

// Aksi Khusus Administrator (Buat Sesi, Update Penugasan, Close, Rekonsiliasi, Register Unregistered)
router.post('/audits', requireAdmin, auditController.createAudit);
router.post('/audits/:id/assignees', requireAdmin, auditController.updateAssignees);
router.post('/audits/:id/close', requireAdmin, auditController.closeAudit);
router.post('/audits/:id/reconcile', requireAdmin, auditController.reconcileAudit);
router.post('/audits/:id/items/:itemId/register', requireAdmin, auditController.registerUnregisteredItem);

// Aksi Eksekusi Lapangan (Wajib Administrator atau User yang Ditugaskan)
router.post('/api/audits/:id/scan', requireMenu('asset-audits'), auditController.scanAuditAsset);
router.post('/audits/:id/unregistered', requireMenu('asset-audits'), upload.single('photo_evidence'), auditController.addUnregisteredFinding);

module.exports = router;