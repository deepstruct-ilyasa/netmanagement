const crypto = require('crypto');
const db = require('../db');

const SESSION_SECRET = process.env.SESSION_SECRET || 'netasset-hospital-secret-key-2026';

function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const key = parts.shift().trim();
    const val = decodeURIComponent(parts.join('='));
    list[key] = val;
  });
  return list;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, key] = storedHash.split(':');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(derivedKey, 'hex'));
}

function createSessionToken(userId) {
  const payload = `${userId}.${Date.now()}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifySessionToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, timestamp, sig] = parts;
  const payload = `${userId}.${timestamp}`;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  if (sig !== expectedSig) return null;
  return parseInt(userId, 10);
}

// Middleware utama autentikasi & pembangun helper permission
function requireAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const userId = verifySessionToken(cookies.netasset_session);

  if (!userId) {
    return res.redirect('/login');
  }

  const user = db.prepare('SELECT id, full_name, username, role, all_branches, allowed_menus, is_active FROM users WHERE id = ?').get(userId);
  if (!user || user.is_active !== 1) {
    res.clearCookie('netasset_session');
    return res.redirect('/login');
  }

  // Parse daftar menu yang diizinkan
  let parsedMenus = [];
  try {
    parsedMenus = JSON.parse(user.allowed_menus || '[]');
  } catch (e) {
    parsedMenus = ['topology', 'devices'];
  }
  user.menus = parsedMenus;

  // Ambil daftar branch_id jika bukan administrator dan bukan all_branches
  const branchRows = db.prepare('SELECT branch_id FROM user_branches WHERE user_id = ?').all(user.id);
  user.allowed_branch_ids = branchRows.map(r => Number(r.branch_id));

  // Grup menu yang digabung ke dalam 1 hak akses 'assets'
  const assetGroupMenus = ['assets', 'device-types', 'brands', 'device-models', 'manufactures'];

  // Helper pengecekan akses menu
  const hasMenuAccess = (menuKey) => {
    if (user.role === 'administrator') return true;
    if (user.menus.includes(menuKey)) return true;

    // Jika menuKey termasuk grup Master Assets, cukup punya akses 'assets' (atau salah satu sub-menu lama)
    if (assetGroupMenus.includes(menuKey)) {
      return assetGroupMenus.some(k => user.menus.includes(k));
    }

    return false;
  };

  // Helper terpusat untuk mengecek izin menu maupun aksi CRUD
  const can = (permission) => {
    if (user.role === 'administrator') return true;

    // 1. Cek akses menu berdasarkan checkbox allowed_menus user
    if (permission.startsWith('menu.')) {
      const menuKey = permission.replace('menu.', '');
      return hasMenuAccess(menuKey);
    }

    // 2. Cek izin tulis / operasional (viewer murni read-only)
    if (user.role === 'viewer') return false;

    if (user.role === 'branch_user') {
      // Seluruh operasi tulis Assets, Mutasi, Service, Device Types, Brand & Model jadi 1 hak akses
      if (['asset.write', 'device_type.write', 'brand.write', 'model.write', 'manufacture.write'].includes(permission)) {
        return hasMenuAccess('assets');
      }
      if (permission === 'device.write' || permission === 'port.connect') {
        return hasMenuAccess('devices');
      }
      if (permission === 'branch.write') {
        return hasMenuAccess('branches');
      }
      if (permission === 'user.write') {
        return hasMenuAccess('users');
      }
      return false;
    }

    return false;
  };

  // Helper validasi apakah user berhak atas branchId tertentu (Anti-IDOR)
  const canAccessBranch = (branchId) => {
    if (user.role === 'administrator' || user.all_branches === 1) return true;
    return user.allowed_branch_ids.includes(Number(branchId));
  };

  req.user = user;
  req.can = can;
  req.canAccessBranch = canAccessBranch;

  res.locals.currentUser = user;
  res.locals.can = can;

  next();
}

// Guard Route: Wajib memiliki akses ke menu tertentu
function requireMenu(menuKey) {
  return (req, res, next) => {
    if (!req.can || !req.can(`menu.${menuKey}`)) {
      return res.status(403).render('forbidden', {
        title: '403 Akses Ditolak',
        message: 'Anda tidak memiliki hak akses untuk membuka halaman atau menu ini.'
      });
    }
    next();
  };
}

// Guard Route: Blokir role 'viewer' dari seluruh operasi tulis (POST/CRUD)
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.can || !req.can(permission)) {
      return res.status(403).render('forbidden', {
        title: '403 Akses Ditolak',
        message: 'Role Anda (Read-Only / Terbatas) tidak diizinkan melakukan perubahan data.'
      });
    }
    next();
  };
}

// Guard Route: Khusus Administrator
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'administrator') {
    return res.status(403).render('forbidden', {
      title: '403 Akses Ditolak',
      message: 'Halaman ini hanya dapat diakses oleh Administrator.'
    });
  }
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSessionToken,
  requireAuth,
  requireMenu,
  requirePermission,
  requireAdmin
};