const db = require('../db');
const { logAudit } = require('../utils/auditLogger');

exports.showVisual = (req, res) => {
  const deviceId = req.params.id;

  const device = db.prepare(`
    SELECT
      d.*,
      b.branch_code,
      b.branch_name,
      dt.type_name,
      dt.is_switch,
      a.asset_code,
      a.status AS asset_status,
      a.condition AS asset_condition,
      COALESCE(br.brand_name, d.brand) AS display_brand,
      COALESCE(dm.model_name, d.model) AS display_model
    FROM devices d
    JOIN branches b ON d.branch_id = b.id
    JOIN device_types dt ON d.device_type_id = dt.id
    LEFT JOIN assets a ON d.asset_id = a.id
    LEFT JOIN brands br ON d.brand_id = br.id
    LEFT JOIN device_models dm ON d.model_id = dm.id
    WHERE d.id = ?
  `).get(deviceId);

  if (!device) return res.redirect('/devices');

  if (!req.canAccessBranch(device.branch_id)) {
    return res.status(403).render('forbidden', {
      title: '403 Akses Ditolak',
      message: 'Anda tidak memiliki hak akses untuk melihat perangkat cabang ini.'
    });
  }

  const ports = db.prepare(`
    SELECT
      p.*,
      c.id AS connection_id,
      c.cable_type,
      c.link_speed,
      c.vlan_info,
      c.notes,
      c.end_device_info,
      CASE WHEN c.source_port_id = p.id THEN tp.id ELSE sp.id END AS peer_port_id,
      CASE WHEN c.source_port_id = p.id THEN tp.port_name ELSE sp.port_name END AS peer_port_name,
      CASE WHEN c.source_port_id = p.id THEN td.id ELSE sd.id END AS peer_device_id,
      CASE WHEN c.source_port_id = p.id THEN td.hostname ELSE sd.hostname END AS peer_device_hostname
    FROM device_ports p
    LEFT JOIN connections c ON (c.source_port_id = p.id OR c.target_port_id = p.id)
    LEFT JOIN device_ports sp ON c.source_port_id = sp.id
    LEFT JOIN devices sd ON sp.device_id = sd.id
    LEFT JOIN device_ports tp ON c.target_port_id = tp.id
    LEFT JOIN devices td ON tp.device_id = td.id
    WHERE p.device_id = ?
    ORDER BY p.id ASC
  `).all(deviceId);

  const portGroups = {
    RJ45: ports.filter(p => p.port_type === 'RJ45'),
    SFP: ports.filter(p => p.port_type === 'SFP'),
    'SFP+': ports.filter(p => p.port_type === 'SFP+'),
    'QSFP+': ports.filter(p => p.port_type === 'QSFP+'),
    QSFP28: ports.filter(p => p.port_type === 'QSFP28')
  };

  const peerDevices = db.prepare(`
    SELECT d.id, d.hostname, dt.type_name, d.room_location
    FROM devices d
    JOIN device_types dt ON d.device_type_id = dt.id
    WHERE d.branch_id = ? AND d.id != ?
    ORDER BY d.hostname ASC
  `).all(device.branch_id, deviceId);

  res.render('device-visual', {
    title: `Visual Faceplate - ${device.hostname}`,
    activeMenu: 'devices',
    device,
    ports,
    portGroups,
    peerDevices
  });
};

exports.getAvailablePorts = (req, res) => {
  const targetDeviceId = req.params.deviceId;
  const targetDevice = db.prepare('SELECT branch_id FROM devices WHERE id = ?').get(targetDeviceId);
  if (!targetDevice || !req.canAccessBranch(targetDevice.branch_id)) {
    return res.status(403).json([]);
  }

  const availablePorts = db.prepare(`
    SELECT p.id, p.port_name, p.port_type, p.port_capacity
    FROM device_ports p
    LEFT JOIN connections c ON (c.source_port_id = p.id OR c.target_port_id = p.id)
    WHERE p.device_id = ? AND c.id IS NULL
    ORDER BY p.id ASC
  `).all(targetDeviceId);

  res.json(availablePorts);
};

exports.savePortConnection = (req, res) => {
  const portId = req.params.portId;
  const {
    device_id, port_name, connection_mode, target_port_id,
    end_device_info, cable_type, link_speed, vlan_info, notes
  } = req.body;

  const portInfo = db.prepare(`
    SELECT p.port_name AS old_name, d.id AS device_id, d.hostname, d.branch_id
    FROM device_ports p
    JOIN devices d ON p.device_id = d.id
    WHERE p.id = ?
  `).get(portId);

  if (!portInfo || !req.canAccessBranch(portInfo.branch_id)) {
    return res.status(403).render('forbidden', {
      title: '403 Akses Ditolak',
      message: 'Anda tidak memiliki hak akses untuk mengubah port pada cabang ini.'
    });
  }

  let logDesc = `Memperbarui konfigurasi ${port_name || portInfo.old_name} pada ${portInfo.hostname}.`;

  const saveTx = db.transaction(() => {
    if (port_name && port_name.trim() !== '') {
      db.prepare('UPDATE device_ports SET port_name = ? WHERE id = ?').run(port_name.trim(), portId);
    }

    db.prepare('DELETE FROM connections WHERE source_port_id = ? OR target_port_id = ?').run(portId, portId);

    if (connection_mode === 'device' && target_port_id) {
      db.prepare('DELETE FROM connections WHERE source_port_id = ? OR target_port_id = ?').run(target_port_id, target_port_id);
      db.prepare(`
        INSERT INTO connections (source_port_id, target_port_id, cable_type, link_speed, vlan_info, notes)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(portId, target_port_id, cable_type || 'UTP Cat6', link_speed || '1G', vlan_info || null, notes || null);

      const targetInfo = db.prepare(`
        SELECT p.port_name, d.hostname FROM device_ports p JOIN devices d ON p.device_id = d.id WHERE p.id = ?
      `).get(target_port_id);
      if (targetInfo) {
        logDesc = `Menghubungkan ${portInfo.hostname} (${port_name || portInfo.old_name}) <-> ${targetInfo.hostname} (${targetInfo.port_name}) [${cable_type || 'UTP Cat6'} / ${link_speed || '1G'}].`;
      }
    } else if (connection_mode === 'end_device' && end_device_info && end_device_info.trim() !== '') {
      db.prepare(`
        INSERT INTO connections (source_port_id, end_device_info, cable_type, link_speed, vlan_info, notes)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(portId, end_device_info.trim(), cable_type || 'UTP Cat6', link_speed || '1G', vlan_info || null, notes || null);

      logDesc = `Menghubungkan ${portInfo.hostname} (${port_name || portInfo.old_name}) -> End Device "${end_device_info.trim()}".`;
    }
  });

  saveTx();
  logAudit(req, {
    action: 'CONNECT',
    entityType: 'port',
    entityId: portId,
    branchId: portInfo.branch_id,
    description: logDesc
  });

  res.redirect(`/devices/${device_id}/visual`);
};

exports.disconnectPort = (req, res) => {
  const portId = req.params.portId;
  const { device_id } = req.body;

  const portInfo = db.prepare(`
    SELECT p.port_name, d.hostname, d.branch_id
    FROM device_ports p
    JOIN devices d ON p.device_id = d.id
    WHERE p.id = ?
  `).get(portId);

  if (!portInfo || !req.canAccessBranch(portInfo.branch_id)) {
    return res.status(403).render('forbidden', {
      title: '403 Akses Ditolak',
      message: 'Anda tidak memiliki hak akses untuk memutus koneksi pada cabang ini.'
    });
  }

  db.prepare('DELETE FROM connections WHERE source_port_id = ? OR target_port_id = ?').run(portId, portId);

  logAudit(req, {
    action: 'DISCONNECT',
    entityType: 'port',
    entityId: portId,
    branchId: portInfo.branch_id,
    description: `Memutus koneksi kabel pada ${portInfo.hostname} (${portInfo.port_name}).`
  });

  res.redirect(`/devices/${device_id}/visual`);
};