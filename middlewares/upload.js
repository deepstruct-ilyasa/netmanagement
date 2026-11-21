const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads/'),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

// Middleware siap pakai untuk 2 field foto
const devicePhotosUpload = upload.fields([
  { name: 'physical_photo', maxCount: 1 },
  { name: 'sn_photo', maxCount: 1 }
]);

module.exports = devicePhotosUpload;