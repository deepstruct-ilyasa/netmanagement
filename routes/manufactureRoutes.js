const express = require('express');
const router = express.Router();
const manufactureController = require('../controllers/manufactureController');
const { requireMenu, requirePermission } = require('../middlewares/authMiddleware');

// Redirect kompatibel jika mengakses URL lama
router.get('/manufactures', (req, res) => {
  if (req.can && req.can('menu.brands')) return res.redirect('/brands');
  if (req.can && req.can('menu.device-models')) return res.redirect('/device-models');
  return res.status(403).render('forbidden', {
    title: '403 Akses Ditolak',
    message: 'Anda tidak memiliki hak akses untuk membuka menu ini.'
  });
});

// Master Brand / Merk (Menu: 'brands', Write: 'brand.write')
router.get('/brands', requireMenu('brands'), manufactureController.indexBrands);
router.post('/brands', requirePermission('brand.write'), manufactureController.storeBrand);
router.post('/brands/:id/update', requirePermission('brand.write'), manufactureController.updateBrand);
router.post('/brands/:id/delete', requirePermission('brand.write'), manufactureController.destroyBrand);

// Master Model / Type (Menu: 'device-models', Write: 'model.write')
router.get('/device-models', requireMenu('device-models'), manufactureController.indexModels);
router.post('/device-models', requirePermission('model.write'), manufactureController.storeModel);
router.post('/device-models/:id/update', requirePermission('model.write'), manufactureController.updateModel);
router.post('/device-models/:id/delete', requirePermission('model.write'), manufactureController.destroyModel);

module.exports = router;