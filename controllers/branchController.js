const db = require('../db');
const { logAudit } = require('../utils/auditLogger');

exports.index = (req, res) => {
  const accessibleBranches = req.accessibleBranches || [];
  let query = `
    SELECT b.*, COUNT(d.id) as device_count
    FROM branches b
    LEFT JOIN devices d ON d.branch_id = b.id
  `;
  const params = [];

  if (req.user.role !== 'administrator' && req.user.all_branches !== 1) {
    if (accessibleBranches.length === 0) {
      query += ' WHERE 1 = 0';
    } else {
      const placeholders = accessibleBranches.map(() => '?').join(',');
      query += ` WHERE b.id IN (${placeholders})`;
      params.push(...accessibleBranches.map(b => b.id));
    }
  }

  query += ' GROUP BY b.id ORDER BY b.branch_name ASC';
  const branches = db.prepare(query).all(...params);

  res.render('branches', {
    title: 'Master Cabang',
    activeMenu: 'branches',
    branches,
    errorMsg: req.query.error || null
  });
};

exports.store = (req, res) => {
  const { branch_code, branch_name, address } = req.body;
  try {
    const info = db.prepare(`
      INSERT INTO branches (branch_code, branch_name, address)
      VALUES (?, ?, ?)
    `).run(branch_code.trim().toUpperCase(), branch_name.trim(), address ? address.trim() : null);

    logAudit(req, {
      action: 'CREATE',
      entityType: 'branch',
      entityId: info.lastInsertRowid,
      branchId: info.lastInsertRowid,
      description: `Menambahkan cabang baru [${branch_code.trim().toUpperCase()}] ${branch_name.trim()}.`
    });
    res.redirect('/branches');
  } catch (err) {
    res.redirect('/branches?error=' + encodeURIComponent('Kode cabang sudah terdaftar! Gunakan kode lain.'));
  }
};

exports.update = (req, res) => {
  const { branch_code, branch_name, address } = req.body;
  try {
    db.prepare(`
      UPDATE branches
      SET branch_code = ?, branch_name = ?, address = ?
      WHERE id = ?
    `).run(branch_code.trim().toUpperCase(), branch_name.trim(), address ? address.trim() : null, req.params.id);

    logAudit(req, {
      action: 'UPDATE',
      entityType: 'branch',
      entityId: req.params.id,
      branchId: req.params.id,
      description: `Memperbarui data cabang [${branch_code.trim().toUpperCase()}] ${branch_name.trim()}.`
    });
    res.redirect('/branches');
  } catch (err) {
    res.redirect('/branches?error=' + encodeURIComponent('Gagal update: Kode cabang sudah digunakan oleh cabang lain!'));
  }
};

exports.destroy = (req, res) => {
  const usage = db.prepare('SELECT COUNT(*) as total FROM devices WHERE branch_id = ?').get(req.params.id);
  if (usage.total > 0) {
    return res.redirect('/branches?error=' + encodeURIComponent(`Tidak bisa dihapus! Masih ada ${usage.total} perangkat terdaftar di cabang ini.`));
  }

  const target = db.prepare('SELECT branch_code, branch_name FROM branches WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM branches WHERE id = ?').run(req.params.id);

  if (target) {
    logAudit(req, {
      action: 'DELETE',
      entityType: 'branch',
      entityId: req.params.id,
      description: `Menghapus cabang [${target.branch_code}] ${target.branch_name}.`
    });
  }
  res.redirect('/branches');
};