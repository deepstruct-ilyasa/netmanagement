const db = require('../db');
const { verifyPassword, createSessionToken } = require('../middlewares/authMiddleware');
const { logAudit } = require('../utils/auditLogger');

exports.showLogin = (req, res) => {
  res.render('login', {
    title: 'Login - SIMAJAR',
    errorMsg: req.query.error || null
  });
};

exports.login = (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.redirect('/login?error=' + encodeURIComponent('Username dan password wajib diisi.'));
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim().toLowerCase());
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.redirect('/login?error=' + encodeURIComponent('Username atau password salah.'));
  }

  if (user.is_active !== 1) {
    return res.redirect('/login?error=' + encodeURIComponent('Akun Anda dinonaktifkan. Hubungi Administrator.'));
  }

  const token = createSessionToken(user.id);
  res.cookie('netasset_session', token, {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax'
  });

  res.clearCookie('selected_branch_id');

  // Catat login ke audit log
  req.user = user;
  logAudit(req, {
    action: 'LOGIN',
    entityType: 'auth',
    entityId: user.id,
    description: `User ${user.full_name} (${user.username}) berhasil login ke sistem.`
  });

  // Arahkan ke menu pertama yang diizinkan untuk user tersebut
  let menus = [];
  try { menus = JSON.parse(user.allowed_menus || '[]'); } catch (e) {}
  if (user.role === 'administrator' || menus.includes('devices')) return res.redirect('/');
  if (menus.includes('topology')) return res.redirect('/topology');
  if (menus.length > 0) return res.redirect(`/${menus[0]}`);
  return res.redirect('/');
};

exports.logout = (req, res) => {
  res.clearCookie('netasset_session');
  res.clearCookie('selected_branch_id');
  res.clearCookie('session_expires_at')
  res.redirect('/login');
};