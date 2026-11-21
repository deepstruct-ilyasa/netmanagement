const express = require('express');
const router = express.Router();
const auditLogController = require('../controllers/auditLogController');
const { requireMenu } = require('../middlewares/authMiddleware');

router.get('/audit-logs', requireMenu('audit-logs'), auditLogController.index);

module.exports = router;