const db = require('../db');
const { hashPassword } = require('../middlewares/authMiddleware');
const { logAudit } = require('../utils/auditLogger');

exports.index = (req, res) => {
  const branches = db.prepare('SELECT * FROM branches ORDER BY branch_name ASC').all();
  const rawUsers = db.prepare('SELECT id, full_name, username, role, all_branches, allowed_menus, is_active, created_at FROM users ORDER BY id ASC').all();

  const userBranchStmt = db.prepare(`
    SELECT b.id, b.branch_code, b.branch_name
    FROM user_branches ub
    JOIN branches b ON ub.branch_id = b.id
    WHERE ub.user_id = ?
    ORDER BY b.branch_name ASC
  `);

  const users = rawUsers.map(u => {
    const userBranches = userBranchStmt.all(u.id);
    let menus = [];
    try { menus = JSON.parse(u.allowed_menus || '[]'); } catch (e) {}
    return {
      ...u,
      menus,
      branches: userBranches,
      branch_ids: userBranches.map(b => b.id)
    };
  });

  res.render('users', {
    title: 'Users & Access',
    activeMenu: 'users',
    users,
    branches,
    errorMsg: req.query.error || null,
    successMsg: req.query.success || null
  });
};

exports.store = (req, res) => {
  const { full_name, username, password, role, branch_scope, is_active } = req.body;
  let branchIds = req.body.branch_ids || [];
  if (!Array.isArray(branchIds)) branchIds = [branchIds];

  let allowedMenus = req.body.allowed_menus || [];
  if (!Array.isArray(allowedMenus)) allowedMenus = [allowedMenus];

  if (!full_name || !username || !password) {
    return res.redirect('/users?error=' + encodeURIComponent('Nama lengkap, username, dan password wajib diisi.'));
  }

  const validRoles = ['administrator', 'branch_user', 'viewer'];
  const finalRole = validRoles.includes(role) ? role : 'branch_user';
  const isAllBranches = finalRole === 'administrator' || branch_scope === 'all' ? 1 : 0;
  const finalMenus = finalRole === 'administrator'
    ? ['topology', 'devices', 'branches', 'device-types', 'users', 'audit-logs', 'manufactures']
    : allowedMenus;

  try {
    let newUserId;
    const tx = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO users (full_name, username, password_hash, role, all_branches, allowed_menus, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        full_name.trim(),
        username.trim().toLowerCase(),
        hashPassword(password),
        finalRole,
        isAllBranches,
        JSON.stringify(finalMenus),
        is_active === '1' ? 1 : 0
      );

      newUserId = info.lastInsertRowid;
      if (isAllBranches === 0 && branchIds.length > 0) {
        const insertUb = db.prepare('INSERT INTO user_branches (user_id, branch_id) VALUES (?, ?)');
        branchIds.forEach(bId => insertUb.run(newUserId, bId));
      }
    });

    tx();
    logAudit(req, {
      action: 'CREATE',
      entityType: 'user',
      entityId: newUserId,
      description: `Menambahkan user baru "${full_name.trim()}" (${username.trim().toLowerCase()}) dengan role ${finalRole}.`
    });
    res.redirect('/users?success=' + encodeURIComponent('User baru berhasil ditambahkan.'));
  } catch (err) {
    res.redirect('/users?error=' + encodeURIComponent('Username sudah terdaftar. Gunakan username lain.'));
  }
};

exports.update = (req, res) => {
  const userId = Number(req.params.id);
  const { full_name, username, password, role, is_active, branch_scope } = req.body;
  const cleanUsername = (username || '').trim().toLowerCase();

  if (!full_name || !cleanUsername) {
    return res.redirect('/users?error=' + encodeURIComponent('Nama lengkap dan username wajib diisi.'));
  }

  // Pastikan mengecualikan userId yang sedang diedit (AND id != ?)
  const existingUser = db.prepare(
    'SELECT id FROM users WHERE LOWER(username) = ? AND id != ?'
  ).get(cleanUsername, userId);

  if (existingUser) {
    return res.redirect('/users?error=' + encodeURIComponent('Gagal update: Username sudah digunakan akun lain.'));
  }

  let branchIds = req.body.branch_ids || [];
  if (!Array.isArray(branchIds)) branchIds = [branchIds];
  // Bersihkan nilai kosong dan pastikan berupa angka valid
  branchIds = branchIds.map(id => Number(id)).filter(id => Number.isInteger(id) && id > 0);

  let allowedMenus = req.body.allowed_menus || [];
  if (!Array.isArray(allowedMenus)) allowedMenus = [allowedMenus];

  const validRoles = ['administrator', 'branch_user', 'viewer'];
  const finalRole = String(req.user.id) === String(userId)
    ? 'administrator'
    : (validRoles.includes(role) ? role : 'branch_user');
  const finalActive = String(req.user.id) === String(userId) ? 1 : (is_active === '1' ? 1 : 0);
  const isAllBranches = finalRole === 'administrator' || branch_scope === 'all' ? 1 : 0;
  const finalMenus = finalRole === 'administrator'
    ? ['topology', 'devices', 'branches', 'device-types', 'users', 'audit-logs', 'manufactures']
    : allowedMenus;

  try {
    const tx = db.transaction(() => {
      if (password && password.trim() !== '') {
        db.prepare(`
          UPDATE users
          SET full_name = ?, username = ?, password_hash = ?, role = ?, all_branches = ?, allowed_menus = ?, is_active = ?
          WHERE id = ?
        `).run(full_name.trim(), cleanUsername, hashPassword(password), finalRole, isAllBranches, JSON.stringify(finalMenus), finalActive, userId);
      } else {
        db.prepare(`
          UPDATE users
          SET full_name = ?, username = ?, role = ?, all_branches = ?, allowed_menus = ?, is_active = ?
          WHERE id = ?
        `).run(full_name.trim(), cleanUsername, finalRole, isAllBranches, JSON.stringify(finalMenus), finalActive, userId);
      }

      db.prepare('DELETE FROM user_branches WHERE user_id = ?').run(userId);
      if (isAllBranches === 0 && branchIds.length > 0) {
        const insertUb = db.prepare('INSERT INTO user_branches (user_id, branch_id) VALUES (?, ?)');
        branchIds.forEach(bId => insertUb.run(userId, bId));
      }
    });

    tx();
    logAudit(req, {
      action: 'UPDATE',
      entityType: 'user',
      entityId: userId,
      description: `Memperbarui data & hak akses user "${full_name.trim()}" (${cleanUsername}).`
    });
    res.redirect('/users?success=' + encodeURIComponent('Data user berhasil diperbarui.'));
  } catch (err) {
    console.error('Error update user:', err);
    const errMsg = err.code === 'SQLITE_CONSTRAINT_UNIQUE'
      ? 'Gagal update: Username sudah digunakan akun lain.'
      : `Gagal update user: ${err.message}`;
    res.redirect('/users?error=' + encodeURIComponent(errMsg));
  }
};

exports.destroy = (req, res) => {
  const userId = req.params.id;
  if (String(req.user.id) === String(userId)) {
    return res.redirect('/users?error=' + encodeURIComponent('Anda tidak dapat menghapus akun Anda sendiri yang sedang login.'));
  }

  const target = db.prepare('SELECT full_name, username FROM users WHERE id = ?').get(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);

  if (target) {
    logAudit(req, {
      action: 'DELETE',
      entityType: 'user',
      entityId: userId,
      description: `Menghapus akun user "${target.full_name}" (${target.username}).`
    });
  }
  res.redirect('/users?success=' + encodeURIComponent('User berhasil dihapus.'));
};