const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const assetController = require('../controllers/assetController');
const { requirePermission } = require('../middlewares/authMiddleware');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'public', 'uploads'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const prefix = file.fieldname === 'sn_photo' ? 'asset_sn' : 'asset_phys';
    cb(null, `${prefix}_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // Maks 5MB per foto
});

const assetUploads = upload.fields([
  { name: 'physical_photo', maxCount: 1 },
  { name: 'sn_photo', maxCount: 1 }
]);

// Halaman Validasi / Scan QR Stiker Aset
router.get('/assets/validate', assetController.validateAssetPage);
router.get('/api/assets/validate', assetController.apiValidateAsset);

// Halaman Utama & Detail Aset
router.get('/assets', requirePermission('menu.assets'), assetController.listAssets);
router.get('/assets/:id', requirePermission('menu.assets'), assetController.detailAsset);

// Menu Terpisah: Riwayat Mutasi & Riwayat Service
router.get('/asset-movements', requirePermission('menu.assets'), assetController.listMovements);
router.get('/asset-maintenances', requirePermission('menu.assets'), assetController.listMaintenances);

// Aksi CRUD, Mutasi & Service
router.post('/assets', requirePermission('asset.write'), assetUploads, assetController.createAsset);
router.post('/assets/settings', requirePermission('asset.write'), assetController.updateAssetSettings);
router.post('/assets/move', requirePermission('asset.write'), assetController.moveAsset);
router.post('/assets/maintenance', requirePermission('asset.write'), assetController.addMaintenance);
router.post('/assets/:id/update', requirePermission('asset.write'), assetUploads, assetController.updateAsset);
router.post('/assets/:id/delete-photo', requirePermission('asset.write'), assetController.deleteAssetPhoto);
router.post('/assets/:id/move', requirePermission('asset.write'), assetController.moveAsset);
router.post('/assets/:id/maintenance', requirePermission('asset.write'), assetController.addMaintenance);
router.post('/assets/:id/delete', requirePermission('asset.write'), assetController.deleteAsset);

module.exports = router;