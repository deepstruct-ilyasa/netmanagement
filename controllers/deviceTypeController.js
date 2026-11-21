const db = require('../db');
const { logAudit } = require('../utils/auditLogger');

exports.index = (req, res) => {
  const errorMsg = req.query.error || null;
  const successMsg = req.query.success || null;
  const selectedBranchId = req.selectedBranchId || 'all';
  const accessibleBranches = req.accessibleBranches || [];

  let branchFilterSql = '';
  let branchParams = [];

  if (selectedBranchId === 'none' || accessibleBranches.length === 0) {
    branchFilterSql = 'AND 1 = 0';
  } else if (selectedBranchId !== 'all') {
    branchFilterSql = 'AND d.branch_id = ?';
    branchParams = [selectedBranchId];
  } else {
    const placeholders = accessibleBranches.map(() => '?').join(',');
    branchFilterSql = `AND d.branch_id IN (${placeholders})`;
    branchParams = accessibleBranches.map(b => b.id);
  }

  const rawTypes = db.prepare(`
    SELECT dt.*,
      (SELECT COUNT(*) FROM devices d WHERE d.device_type_id = dt.id ${branchFilterSql}) AS device_count
    FROM device_types dt
    ORDER BY dt.type_name ASC
  `).all(...branchParams);

  const branchBreakdownRows = db.prepare(`
    SELECT
      d.device_type_id,
      b.branch_code,
      b.branch_name,
      COUNT(d.id) AS unit_count
    FROM devices d
    JOIN branches b ON d.branch_id = b.id
    WHERE 1 = 1 ${branchFilterSql}
    GROUP BY d.device_type_id, b.id, b.branch_code, b.branch_name
    ORDER BY b.branch_code ASC
  `).all(...branchParams);

  const deviceTypes = rawTypes.map(dt => {
    const branchItems = branchBreakdownRows.filter(r => r.device_type_id === dt.id);
    return {
      ...dt,
      rowspan: Math.max(branchItems.length, 1),
      branches: branchItems
    };
  });

  res.render('device-types', {
    title: 'Master Jenis Perangkat',
    activeMenu: 'device-types',
    deviceTypes,
    errorMsg,
    successMsg
  });
};

exports.create = (req, res) => {
  const { type_name, is_switch } = req.body;
  const switchFlag = is_switch === '1' ? 1 : 0;

  if (!type_name || !type_name.trim()) {
    return res.redirect('/device-types?error=' + encodeURIComponent('Nama jenis perangkat wajib diisi.'));
  }

  try {
    const info = db.prepare('INSERT INTO device_types (type_name, is_switch) VALUES (?, ?)').run(type_name.trim(), switchFlag);
    logAudit(req, {
      action: 'CREATE',
      entityType: 'device_type',
      entityId: info.lastInsertRowid,
      description: `Menambahkan jenis perangkat "${type_name.trim()}".`
    });
    res.redirect('/device-types?success=' + encodeURIComponent(`Jenis perangkat "${type_name.trim()}" berhasil ditambahkan.`));
  } catch (err) {
    res.redirect('/device-types?error=' + encodeURIComponent('Jenis perangkat sudah ada atau gagal disimpan.'));
  }
};

exports.update = (req, res) => {
  const { id } = req.params;
  const { type_name, is_switch } = req.body;
  const switchFlag = is_switch === '1' ? 1 : 0;

  if (!type_name || !type_name.trim()) {
    return res.redirect('/device-types?error=' + encodeURIComponent('Nama jenis perangkat wajib diisi.'));
  }

  try {
    db.prepare('UPDATE device_types SET type_name = ?, is_switch = ? WHERE id = ?').run(type_name.trim(), switchFlag, id);
    logAudit(req, {
      action: 'UPDATE',
      entityType: 'device_type',
      entityId: id,
      description: `Memperbarui jenis perangkat menjadi "${type_name.trim()}".`
    });
    res.redirect('/device-types?success=' + encodeURIComponent(`Jenis perangkat berhasil diperbarui menjadi "${type_name.trim()}".`));
  } catch (err) {
    res.redirect('/device-types?error=' + encodeURIComponent('Gagal memperbarui jenis perangkat (nama duplikat).'));
  }
};

exports.delete = (req, res) => {
  const { id } = req.params;
  const usage = db.prepare('SELECT COUNT(*) AS total FROM devices WHERE device_type_id = ?').get(id);
  if (usage && usage.total > 0) {
    return res.redirect('/device-types?error=' + encodeURIComponent(`Jenis perangkat tidak dapat dihapus karena masih digunakan oleh ${usage.total} perangkat.`));
  }

  const target = db.prepare('SELECT type_name FROM device_types WHERE id = ?').get(id);
  db.prepare('DELETE FROM device_types WHERE id = ?').run(id);
  if (target) {
    logAudit(req, {
      action: 'DELETE',
      entityType: 'device_type',
      entityId: id,
      description: `Menghapus jenis perangkat "${target.type_name}".`
    });
  }
  res.redirect('/device-types?success=' + encodeURIComponent('Jenis perangkat berhasil dihapus.'));
};

exports.store = exports.create;
exports.destroy = exports.delete;
exports.remove = exports.delete;