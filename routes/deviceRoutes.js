const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/deviceController');
const portController = require('../controllers/portController');
const { requireMenu, requirePermission } = require('../middlewares/authMiddleware');

// Master Devices CRUD (View by menu.devices, Write by device.write)
router.get('/devices', requireMenu('devices'), deviceController.index);
router.post('/devices', requirePermission('device.write'), deviceController.store);
router.post('/devices/:id/update', requirePermission('device.write'), deviceController.update);
router.post('/devices/:id/delete', requirePermission('device.write'), deviceController.destroy);

// Interactive Faceplate & Port Connections (View by menu.devices, Connect/Disconnect by port.connect)
router.get('/devices/:id/visual', requireMenu('devices'), portController.showVisual);
router.get('/api/devices/:deviceId/available-ports', requireMenu('devices'), portController.getAvailablePorts);
router.post('/ports/:portId/connect', requirePermission('port.connect'), portController.savePortConnection);
router.post('/ports/:portId/disconnect', requirePermission('port.connect'), portController.disconnectPort);

module.exports = router;