const express = require('express');
const router = express.Router();
const topologyController = require('../controllers/topologyController');
const { requireMenu } = require('../middlewares/authMiddleware');

router.get('/topology', requireMenu('topology'), topologyController.index);

module.exports = router;