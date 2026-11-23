const express = require('express');
const router = express.Router();
const manufactureController = require('../controllers/manufactureController');
const deviceTypeController = require('../controllers/deviceTypeController');
const { requireMenu, requirePermission } = require('../middlewares/authMiddleware');

// Redirect kompatibel jika mengakses URL lama
router.get('/manufactures', requireMenu('assets'), (req, res) => {
  return res.redirect('/brands');
});

// Master Device Types (1 Hak Akses: 'assets')
router.get('/device-types', requireMenu('assets'), deviceTypeController.index);
router.post('/device-types', requirePermission('asset.write'), deviceTypeController.store);
router.post('/device-types/:id/update', requirePermission('asset.write'), deviceTypeController.update);
router.post('/device-types/:id/delete', requirePermission('asset.write'), deviceTypeController.destroy);

// Master Brand / Merk (1 Hak Akses: 'assets')
router.get('/brands', requireMenu('assets'), manufactureController.indexBrands);
router.post('/brands', requirePermission('asset.write'), manufactureController.storeBrand);
router.post('/brands/:id/update', requirePermission('asset.write'), manufactureController.updateBrand);
router.post('/brands/:id/delete', requirePermission('asset.write'), manufactureController.destroyBrand);

// Master Model / Type (1 Hak Akses: 'assets')
router.get('/device-models', requireMenu('assets'), manufactureController.indexModels);
router.post('/device-models', requirePermission('asset.write'), manufactureController.storeModel);
router.post('/device-models/:id/update', requirePermission('asset.write'), manufactureController.updateModel);
router.post('/device-models/:id/delete', requirePermission('asset.write'), manufactureController.destroyModel);

module.exports = router;