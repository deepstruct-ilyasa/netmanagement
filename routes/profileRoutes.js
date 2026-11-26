const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const profileController = require('../controllers/profileController');

const profileUploadDir = path.join(__dirname, '..', 'public', 'img', 'profile');
if (!fs.existsSync(profileUploadDir)) {
  fs.mkdirSync(profileUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, profileUploadDir);
  },
  filename: (req, file, cb) => {
    const rawUsername = (req.user && req.user.username) ? req.user.username : `id_${req.user?.id || 'guest'}`;
    const safeUsername = String(rawUsername).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const ext = path.extname(file.originalname || '.jpg').toLowerCase() || '.jpg';
    cb(null, `user_${safeUsername}${ext}`);
  }
});

const uploadProfilePhoto = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Maksimal 5 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Format foto harus JPG, PNG, atau WEBP.'));
    }
  }
});

router.get('/profile', profileController.showProfile);

router.post('/profile', (req, res, next) => {
  uploadProfilePhoto.single('profile_photo')(req, res, (err) => {
    if (err) {
      return res.redirect('/profile?err=' + encodeURIComponent(err.message || 'Gagal mengunggah foto profil.'));
    }
    return profileController.updateProfile(req, res, next);
  });
});

router.post('/profile/photo/delete', profileController.deleteProfilePhoto);
router.post('/profile/password', profileController.updatePassword);

module.exports = router;