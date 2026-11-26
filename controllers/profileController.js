const fs = require('fs');
const path = require('path');
const db = require('../db');
const { hashPassword, verifyPassword } = require('../middlewares/authMiddleware');
const { logAudit } = require('../utils/auditLogger');

// 1. GET /profile - Halaman Detail & Edit Profil User Login
exports.showProfile = (req, res) => {
  const user = db.prepare(`
    SELECT id, username, full_name, role, all_branches, is_active, profile_photo
    FROM users
    WHERE id = ?
  `).get(req.user.id);

  if (!user) {
    return res.redirect('/logout');
  }

  let allowedBranches = [];
  if (user.role === 'administrator' || Number(user.all_branches) === 1) {
    allowedBranches = db.prepare('SELECT id, branch_code, branch_name FROM branches ORDER BY branch_code ASC').all();
  } else {
    allowedBranches = db.prepare(`
      SELECT b.id, b.branch_code, b.branch_name
      FROM branches b
      JOIN user_branches ub ON ub.branch_id = b.id
      WHERE ub.user_id = ?
      ORDER BY b.branch_code ASC
    `).all(user.id);
  }

  return res.render('profile/profile', {
    title: 'Profil Saya',
    pageTitle: 'Detail & Pengaturan Profil',
    activeMenu: 'profile',
    profileUser: user,
    allowedBranches,
    msg: req.query.msg || '',
    err: req.query.err || ''
  });
};

// 2. POST /profile - Update Nama Lengkap & Foto Profil
exports.updateProfile = (req, res) => {
  const userId = req.user.id;
  const fullName = String(req.body.full_name || '').trim();

  if (!fullName) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.redirect('/profile?err=' + encodeURIComponent('Nama lengkap wajib diisi.'));
  }

  const current = db.prepare('SELECT id, username, full_name, profile_photo FROM users WHERE id = ?').get(userId);
  if (!current) {
    return res.redirect('/logout');
  }

  let newPhotoUrl = current.profile_photo;

  if (req.file) {
    newPhotoUrl = `/img/profile/${req.file.filename}`;

    // Hapus file foto lama jika nama filenya berbeda (misalnya ekstensi berubah dari .png ke .jpg)
    if (current.profile_photo && current.profile_photo !== newPhotoUrl) {
      const oldFilePath = path.join(__dirname, '..', 'public', current.profile_photo);
      if (fs.existsSync(oldFilePath)) {
        try { fs.unlinkSync(oldFilePath); } catch (e) {}
      }
    }
  }

  db.prepare(`
    UPDATE users
    SET full_name = ?, profile_photo = ?
    WHERE id = ?
  `).run(fullName, newPhotoUrl, userId);

  logAudit(req, {
    action: 'UPDATE',
    entityType: 'user',
    entityId: userId,
    description: `User ${current.username} memperbarui profil akun (${fullName})${req.file ? ' beserta foto profil' : ''}.`
  });

  return res.redirect('/profile?msg=' + encodeURIComponent('Profil berhasil diperbarui.'));
};

// 3. POST /profile/photo/delete - Hapus Foto Profil
exports.deleteProfilePhoto = (req, res) => {
  const userId = req.user.id;
  const current = db.prepare('SELECT id, username, profile_photo FROM users WHERE id = ?').get(userId);

  if (current && current.profile_photo) {
    const filePath = path.join(__dirname, '..', 'public', current.profile_photo);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e) {}
    }

    db.prepare('UPDATE users SET profile_photo = NULL WHERE id = ?').run(userId);

    logAudit(req, {
      action: 'DELETE',
      entityType: 'user',
      entityId: userId,
      description: `User ${current.username} menghapus foto profil.`
    });
  }

  return res.redirect('/profile?msg=' + encodeURIComponent('Foto profil berhasil dihapus.'));
};

// 4. POST /profile/password - Ubah Password User
exports.updatePassword = (req, res) => {
  const userId = req.user.id;
  const { current_password, new_password, confirm_password } = req.body;

  if (!current_password || !new_password || !confirm_password) {
    return res.redirect('/profile?err=' + encodeURIComponent('Seluruh kolom password wajib diisi.'));
  }

  if (String(new_password).length < 6) {
    return res.redirect('/profile?err=' + encodeURIComponent('Password baru minimal 6 karakter.'));
  }

  if (new_password !== confirm_password) {
    return res.redirect('/profile?err=' + encodeURIComponent('Konfirmasi password baru tidak cocok.'));
  }

  const user = db.prepare('SELECT id, username, password_hash FROM users WHERE id = ?').get(userId);
  if (!user) return res.redirect('/logout');

  if (!verifyPassword(current_password, user.password_hash)) {
    return res.redirect('/profile?err=' + encodeURIComponent('Password saat ini salah.'));
  }

  const newHashed = hashPassword(new_password);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHashed, userId);

  logAudit(req, {
    action: 'UPDATE',
    entityType: 'user',
    entityId: userId,
    description: `User ${user.username} mengubah password akun secara mandiri.`
  });

  return res.redirect('/profile?msg=' + encodeURIComponent('Password berhasil diperbarui.'));
};