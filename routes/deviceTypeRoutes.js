const express = require('express');
const router = express.Router();
const deviceTypeController = require('../controllers/deviceTypeController');
const { requireMenu, requirePermission } = require('../middlewares/authMiddleware');

router.get('/device-types', requireMenu('device-types'), deviceTypeController.index);
router.post('/device-types', requirePermission('device_type.write'), deviceTypeController.store);
router.post('/device-types/:id/update', requirePermission('device_type.write'), deviceTypeController.update);
router.post('/device-types/:id/delete', requirePermission('device_type.write'), deviceTypeController.destroy);

module.exports = router;