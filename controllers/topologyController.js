const db = require('../db');

exports.index = (req, res) => {
  const selectedBranchId = req.selectedBranchId || req.query.branch_id || 'all';
  const branches = req.accessibleBranches || db.prepare('SELECT * FROM branches ORDER BY branch_name ASC').all();

  // 1. Ambil daftar perangkat beserta jumlah port aktifnya sesuai Scope Cabang
  let deviceQuery = `
    SELECT d.*, b.branch_code, b.branch_name, dt.type_name, dt.is_switch,
      (
        SELECT COUNT(*)
        FROM device_ports p
        JOIN connections c ON (p.id = c.source_port_id OR p.id = c.target_port_id)
        WHERE p.device_id = d.id
      ) AS active_ports_count
    FROM devices d
    JOIN branches b ON d.branch_id = b.id
    JOIN device_types dt ON d.device_type_id = dt.id
  `;
  const params = [];
  if (selectedBranchId !== 'all') {
    deviceQuery += ' WHERE d.branch_id = ?';
    params.push(selectedBranchId);
  } else if (branches.length > 0) {
    const placeholders = branches.map(() => '?').join(',');
    deviceQuery += ` WHERE d.branch_id IN (${placeholders})`;
    params.push(...branches.map(b => b.id));
  }
  deviceQuery += ' ORDER BY b.branch_name ASC, d.hostname ASC';
  const devices = db.prepare(deviceQuery).all(...params);

  // 2. Ambil seluruh jalur koneksi aktif dari tabel connections & device_ports
  let connQuery = `
    SELECT 
      c.id AS connection_id,
      c.cable_type,
      c.link_speed,
      c.vlan_info,
      c.notes,
      c.end_device_info,
      sp.id AS port_a_id,
      sp.port_name AS port_a_name,
      sd.id AS device_a_id,
      sd.hostname AS device_a_hostname,
      sd.branch_id AS device_a_branch_id,
      tp.id AS port_b_id,
      tp.port_name AS port_b_name,
      td.id AS device_b_id,
      td.hostname AS device_b_hostname,
      td.branch_id AS device_b_branch_id
    FROM connections c
    JOIN device_ports sp ON c.source_port_id = sp.id
    JOIN devices sd ON sp.device_id = sd.id
    LEFT JOIN device_ports tp ON c.target_port_id = tp.id
    LEFT JOIN devices td ON tp.device_id = td.id
  `;
  const connParams = [];
  if (selectedBranchId !== 'all') {
    connQuery += ' WHERE sd.branch_id = ? OR td.branch_id = ?';
    connParams.push(selectedBranchId, selectedBranchId);
  } else if (branches.length > 0) {
    const placeholders = branches.map(() => '?').join(',');
    connQuery += ` WHERE sd.branch_id IN (${placeholders}) OR td.branch_id IN (${placeholders})`;
    const branchIds = branches.map(b => b.id);
    connParams.push(...branchIds, ...branchIds);
  }
  const connections = db.prepare(connQuery).all(...connParams);

  res.render('topology', {
    title: 'Topologi Jaringan',
    activeMenu: 'topology',
    branches,
    selectedBranchId,
    devices,
    connections
  });
};