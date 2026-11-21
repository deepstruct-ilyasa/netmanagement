const express = require('express');
const router = express.Router();
const branchController = require('../controllers/branchController');
const { requireMenu, requirePermission } = require('../middlewares/authMiddleware');

router.get('/branches', requireMenu('branches'), branchController.index);
router.post('/branches', requirePermission('branch.write'), branchController.store);
router.post('/branches/:id/update', requirePermission('branch.write'), branchController.update);
router.post('/branches/:id/delete', requirePermission('branch.write'), branchController.destroy);

module.exports = router;