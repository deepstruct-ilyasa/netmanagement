const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { requireMenu, requirePermission } = require('../middlewares/authMiddleware');

router.get('/users', requireMenu('users'), userController.index);
router.post('/users', requirePermission('user.write'), userController.store);
router.post('/users/:id/update', requirePermission('user.write'), userController.update);
router.post('/users/:id/delete', requirePermission('user.write'), userController.destroy);

module.exports = router;