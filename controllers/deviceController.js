const db = require('../db');
const fs = require('fs');
const path = require('path');
const { logAudit } = require('../utils/auditLogger');

exports.index = (req, res) => {
  const selectedBranchId = req.selectedBranchId || 'all';
  const branches = req.accessibleBranches || [];
  const deviceTypes = db.prepare('SELECT * FROM device_types ORDER BY type_name ASC').all();
  const brands = db.prepare('SELECT * FROM brands ORDER BY brand_name ASC').all();
  const deviceModels = db.prepare('SELECT * FROM device_models ORDER BY model_name ASC').all();

  let deviceQuery = `
    SELECT d.*, b.branch_code, b.branch_name, dt.type_name, dt.is_switch,
      COALESCE(br.brand_name, d.brand) AS display_brand,
      COALESCE(dm.model_name, d.model) AS display_model,
      (SELECT COUNT(*) FROM device_ports WHERE device_id = d.id) as total_ports,
      (SELECT COUNT(*) FROM device_ports WHERE device_id = d.id AND port_type = 'RJ45') as rj45_count,
      (SELECT port_capacity FROM device_ports WHERE device_id = d.id AND port_type = 'RJ45' LIMIT 1) as rj45_capacity,
      (SELECT COUNT(*) FROM device_ports WHERE device_id = d.id AND port_type = 'SFP') as sfp_count,
      (SELECT port_capacity FROM device_ports WHERE device_id = d.id AND port_type = 'SFP' LIMIT 1) as sfp_capacity,
      (SELECT COUNT(*) FROM device_ports WHERE device_id = d.id AND port_type = 'SFP+') as sfp_plus_count,
      (SELECT port_capacity FROM device_ports WHERE device_id = d.id AND port_type = 'SFP+' LIMIT 1) as sfp_plus_capacity,
      (SELECT COUNT(*) FROM device_ports WHERE device_id = d.id AND port_type = 'QSFP+') as qsfp_plus_count,
      (SELECT port_capacity FROM device_ports WHERE device_id = d.id AND port_type = 'QSFP+' LIMIT 1) as qsfp_plus_capacity,
      (SELECT COUNT(*) FROM device_ports WHERE device_id = d.id AND port_type = 'QSFP28') as qsfp28_count,
      (SELECT port_capacity FROM device_ports WHERE device_id = d.id AND port_type = 'QSFP28' LIMIT 1) as qsfp28_capacity
    FROM devices d
    JOIN branches b ON d.branch_id = b.id
    JOIN device_types dt ON d.device_type_id = dt.id
    LEFT JOIN brands br ON d.brand_id = br.id
    LEFT JOIN device_models dm ON d.model_id = dm.id
  `;

  const params = [];
  if (selectedBranchId === 'none' || branches.length === 0) {
    deviceQuery += ' WHERE 1 = 0';
  } else if (selectedBranchId !== 'all') {
    deviceQuery += ' WHERE d.branch_id = ?';
    params.push(selectedBranchId);
  } else {
    const placeholders = branches.map(() => '?').join(',');
    deviceQuery += ` WHERE d.branch_id IN (${placeholders})`;
    params.push(...branches.map(b => b.id));
  }

  deviceQuery += ' ORDER BY d.id DESC';
  const devices = db.prepare(deviceQuery).all(...params);

  res.render('devices', {
    title: 'Master Devices',
    activeMenu: 'devices',
    branches,
    deviceTypes,
    brands,
    deviceModels,
    devices
  });
};

exports.store = (req, res) => {
  const {
    branch_id, device_type_id, brand_id, model_id, hostname, switch_management,
    is_poe, ip_address, mac_address, serial_number, room_location,
    port_layout, faceplate_template,
    rj45_count, rj45_capacity, sfp_count, sfp_capacity, sfp_plus_count,
    sfp_plus_capacity, qsfp_plus_count, qsfp_plus_capacity, qsfp28_count, qsfp28_capacity
  } = req.body;

  if (!req.canAccessBranch(branch_id)) {
    return res.status(403).render('forbidden', {
      title: '403 Akses Ditolak',
      message: 'Anda tidak memiliki hak akses untuk menambahkan perangkat di cabang tersebut.'
    });
  }

  const selectedType = db.prepare('SELECT is_switch FROM device_types WHERE id = ?').get(device_type_id);
  const isSwitch = selectedType && selectedType.is_switch === 1;

  const parsedBrandId = brand_id ? Number(brand_id) : null;
  const parsedModelId = model_id ? Number(model_id) : null;
  const brandRow = parsedBrandId ? db.prepare('SELECT brand_name FROM brands WHERE id = ?').get(parsedBrandId) : null;
  const modelRow = parsedModelId ? db.prepare('SELECT model_name FROM device_models WHERE id = ?').get(parsedModelId) : null;

  const physicalPhoto = req.files?.['physical_photo'] ? '/uploads/' + req.files['physical_photo'][0].filename : null;
  const snPhoto = req.files?.['sn_photo'] ? '/uploads/' + req.files['sn_photo'][0].filename : null;

  let newDeviceId;
  const insertTransaction = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO devices (
        branch_id, device_type_id, brand_id, model_id, hostname, brand, model,
        switch_management, is_poe, ip_address, mac_address, serial_number,
        room_location, port_layout, faceplate_template, physical_photo, sn_photo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      branch_id, device_type_id, parsedBrandId, parsedModelId, hostname,
      brandRow ? brandRow.brand_name : null,
      modelRow ? modelRow.model_name : null,
      isSwitch ? switch_management : null,
      isSwitch && is_poe === '1' ? 1 : 0,
      (isSwitch && switch_management === 'Unmanaged') ? null : (ip_address || null),
      mac_address || null, serial_number || null, room_location || null,
      port_layout || '2_row', faceplate_template || 'rackmount',
      physicalPhoto, snPhoto
    );

    newDeviceId = info.lastInsertRowid;
    const insertPort = db.prepare(`
      INSERT INTO device_ports (device_id, port_number, port_name, port_type, port_capacity)
      VALUES (?, ?, ?, ?, ?)
    `);

    const generateGroup = (count, prefixName, portType, capacity) => {
      const total = parseInt(count) || 0;
      for (let i = 1; i <= total; i++) {
        insertPort.run(newDeviceId, i, `${prefixName} ${i}`, portType, capacity);
      }
    };

    generateGroup(rj45_count, 'Port', 'RJ45', rj45_capacity || '1G');
    generateGroup(sfp_count, 'SFP', 'SFP', sfp_capacity || '1G');
    generateGroup(sfp_plus_count, 'SFP+', 'SFP+', sfp_plus_capacity || '10G');
    generateGroup(qsfp_plus_count, 'QSFP+', 'QSFP+', qsfp_plus_capacity || '40G');
    generateGroup(qsfp28_count, 'QSFP28', 'QSFP28', qsfp28_capacity || '100G');
  });

  insertTransaction();
  logAudit(req, {
    action: 'CREATE',
    entityType: 'device',
    entityId: newDeviceId,
    branchId: branch_id,
    description: `Menambahkan perangkat baru "${hostname}" (${brandRow ? brandRow.brand_name : '-'} ${modelRow ? modelRow.model_name : ''}).`
  });

  res.redirect('/devices');
};

exports.update = (req, res) => {
  const deviceId = req.params.id;
  const existingDevice = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
  if (!existingDevice) return res.redirect('/devices');

  const {
    branch_id, device_type_id, brand_id, model_id, hostname, switch_management,
    is_poe, ip_address, mac_address, serial_number, room_location,
    port_layout, faceplate_template,
    rj45_count, rj45_capacity, sfp_count, sfp_capacity, sfp_plus_count,
    sfp_plus_capacity, qsfp_plus_count, qsfp_plus_capacity, qsfp28_count, qsfp28_capacity,
    delete_physical_photo, delete_sn_photo
  } = req.body;

  if (!req.canAccessBranch(existingDevice.branch_id) || !req.canAccessBranch(branch_id)) {
    return res.status(403).render('forbidden', {
      title: '403 Akses Ditolak',
      message: 'Anda tidak memiliki hak akses untuk mengubah perangkat pada cabang tersebut.'
    });
  }

  const selectedType = db.prepare('SELECT is_switch FROM device_types WHERE id = ?').get(device_type_id);
  const isSwitch = selectedType && selectedType.is_switch === 1;

  const parsedBrandId = brand_id ? Number(brand_id) : null;
  const parsedModelId = model_id ? Number(model_id) : null;
  const brandRow = parsedBrandId ? db.prepare('SELECT brand_name FROM brands WHERE id = ?').get(parsedBrandId) : null;
  const modelRow = parsedModelId ? db.prepare('SELECT model_name FROM device_models WHERE id = ?').get(parsedModelId) : null;

  let physicalPhoto = existingDevice.physical_photo;
  if (req.files?.['physical_photo']) {
    if (existingDevice.physical_photo) {
      const oldPath = path.join(__dirname, '..', 'public', existingDevice.physical_photo);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    physicalPhoto = '/uploads/' + req.files['physical_photo'][0].filename;
  } else if (delete_physical_photo === '1') {
    if (existingDevice.physical_photo) {
      const oldPath = path.join(__dirname, '..', 'public', existingDevice.physical_photo);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    physicalPhoto = null;
  }

  let snPhoto = existingDevice.sn_photo;
  if (req.files?.['sn_photo']) {
    if (existingDevice.sn_photo) {
      const oldPath = path.join(__dirname, '..', 'public', existingDevice.sn_photo);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    snPhoto = '/uploads/' + req.files['sn_photo'][0].filename;
  } else if (delete_sn_photo === '1') {
    if (existingDevice.sn_photo) {
      const oldPath = path.join(__dirname, '..', 'public', existingDevice.sn_photo);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    snPhoto = null;
  }

  const updateTransaction = db.transaction(() => {
    db.prepare(`
      UPDATE devices SET
        branch_id = ?, device_type_id = ?, brand_id = ?, model_id = ?, hostname = ?,
        brand = ?, model = ?, switch_management = ?, is_poe = ?, ip_address = ?,
        mac_address = ?, serial_number = ?, room_location = ?, port_layout = ?,
        faceplate_template = ?, physical_photo = ?, sn_photo = ?
      WHERE id = ?
    `).run(
      branch_id, device_type_id, parsedBrandId, parsedModelId, hostname,
      brandRow ? brandRow.brand_name : null,
      modelRow ? modelRow.model_name : null,
      isSwitch ? switch_management : null,
      isSwitch && is_poe === '1' ? 1 : 0,
      (isSwitch && switch_management === 'Unmanaged') ? null : (ip_address || null),
      mac_address || null, serial_number || null, room_location || null,
      port_layout || '2_row', faceplate_template || 'rackmount',
      physicalPhoto, snPhoto, deviceId
    );

    const syncPorts = (portType, prefixName, targetCount, capacity) => {
      const currentPorts = db.prepare(
        'SELECT * FROM device_ports WHERE device_id = ? AND port_type = ? ORDER BY port_number ASC'
      ).all(deviceId, portType);

      if (targetCount > currentPorts.length) {
        const insertPort = db.prepare(
          'INSERT INTO device_ports (device_id, port_number, port_name, port_type, port_capacity) VALUES (?, ?, ?, ?, ?)'
        );
        for (let i = currentPorts.length + 1; i <= targetCount; i++) {
          insertPort.run(deviceId, i, `${prefixName} ${i}`, portType, capacity);
        }
      } else if (targetCount < currentPorts.length) {
        const portsToDelete = currentPorts.slice(targetCount);
        const delStmt = db.prepare('DELETE FROM device_ports WHERE id = ?');
        for (const p of portsToDelete) delStmt.run(p.id);
      }

      db.prepare('UPDATE device_ports SET port_capacity = ? WHERE device_id = ? AND port_type = ?').run(
        capacity, deviceId, portType
      );
    };

    syncPorts('RJ45', 'Port', parseInt(rj45_count) || 0, rj45_capacity || '1G');
    syncPorts('SFP', 'SFP', parseInt(sfp_count) || 0, sfp_capacity || '1G');
    syncPorts('SFP+', 'SFP+', parseInt(sfp_plus_count) || 0, sfp_plus_capacity || '10G');
    syncPorts('QSFP+', 'QSFP+', parseInt(qsfp_plus_count) || 0, qsfp_plus_capacity || '40G');
    syncPorts('QSFP28', 'QSFP28', parseInt(qsfp28_count) || 0, qsfp28_capacity || '100G');
  });

  updateTransaction();
  logAudit(req, {
    action: 'UPDATE',
    entityType: 'device',
    entityId: deviceId,
    branchId: branch_id,
    description: `Memperbarui data perangkat "${hostname}" (IP: ${ip_address || '-'}).`
  });

  res.redirect('/devices');
};

exports.deletePhoto = (req, res) => {
  const deviceId = req.params.id;
  const { photo_type, redirect_to } = req.body;

  const device = db.prepare('SELECT branch_id, hostname, physical_photo, sn_photo FROM devices WHERE id = ?').get(deviceId);
  if (!device) return res.redirect('/devices');

  if (!req.canAccessBranch(device.branch_id)) {
    return res.status(403).render('forbidden', {
      title: '403 Akses Ditolak',
      message: 'Anda tidak memiliki hak akses pada cabang perangkat ini.'
    });
  }

  const column = photo_type === 'sn' ? 'sn_photo' : 'physical_photo';
  const currentFile = device[column];

  if (currentFile) {
    const filePath = path.join(__dirname, '..', 'public', currentFile);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    db.prepare(`UPDATE devices SET ${column} = NULL WHERE id = ?`).run(deviceId);

    logAudit(req, {
      action: 'DELETE',
      entityType: 'device_photo',
      entityId: deviceId,
      branchId: device.branch_id,
      description: `Menghapus foto (${photo_type === 'sn' ? 'Stiker SN' : 'Fisik'}) pada perangkat "${device.hostname}".`
    });
  }

  res.redirect(redirect_to || `/devices/${deviceId}/visual`);
};

exports.destroy = (req, res) => {
  const device = db.prepare('SELECT id, branch_id, hostname, physical_photo, sn_photo FROM devices WHERE id = ?').get(req.params.id);
  if (!device) return res.redirect('/devices');

  if (!req.canAccessBranch(device.branch_id)) {
    return res.status(403).render('forbidden', {
      title: '403 Akses Ditolak',
      message: 'Anda tidak memiliki hak akses untuk menghapus perangkat di cabang ini.'
    });
  }

  [device.physical_photo, device.sn_photo].forEach(photo => {
    if (photo) {
      const filePath = path.join(__dirname, '..', 'public', photo);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  });

  db.prepare('DELETE FROM devices WHERE id = ?').run(req.params.id);
  logAudit(req, {
    action: 'DELETE',
    entityType: 'device',
    entityId: device.id,
    branchId: device.branch_id,
    description: `Menghapus perangkat "${device.hostname}".`
  });

  res.redirect('/devices');
};