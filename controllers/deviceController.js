const db = require('../db');
const { logAudit } = require('../utils/auditLogger');

exports.index = (req, res) => {
  const selectedBranchId = req.selectedBranchId || 'all';
  const branches = req.accessibleBranches || [];

  let deviceQuery = `
    SELECT d.*, b.branch_code, b.branch_name, dt.type_name, dt.is_switch,
      a.asset_code,
      a.status AS asset_status,
      a.condition AS asset_condition,
      COALESCE(a.physical_photo, d.physical_photo) AS physical_photo,
      COALESCE(a.sn_photo, d.sn_photo) AS sn_photo,
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
    LEFT JOIN assets a ON d.asset_id = a.id
    LEFT JOIN brands br ON d.brand_id = br.id
    LEFT JOIN device_models dm ON d.model_id = dm.id
  `;

  let spareQuery = `
    SELECT a.*, b.branch_code, b.branch_name, dt.type_name, dt.is_switch,
      br.brand_name, dm.model_name
    FROM assets a
    JOIN branches b ON a.branch_id = b.id
    JOIN device_types dt ON a.device_type_id = dt.id
    LEFT JOIN brands br ON a.brand_id = br.id
    LEFT JOIN device_models dm ON a.model_id = dm.id
    WHERE a.status = 'spare' AND a.id NOT IN (SELECT asset_id FROM devices WHERE asset_id IS NOT NULL)
  `;

  const params = [];
  const spareParams = [];

  if (selectedBranchId === 'none' || branches.length === 0) {
    deviceQuery += ' WHERE 1 = 0';
    spareQuery += ' AND 1 = 0';
  } else if (selectedBranchId !== 'all') {
    deviceQuery += ' WHERE d.branch_id = ?';
    params.push(selectedBranchId);
    spareQuery += ' AND a.branch_id = ?';
    spareParams.push(selectedBranchId);
  } else {
    const placeholders = branches.map(() => '?').join(',');
    deviceQuery += ` WHERE d.branch_id IN (${placeholders})`;
    params.push(...branches.map(b => b.id));
    spareQuery += ` AND a.branch_id IN (${placeholders})`;
    spareParams.push(...branches.map(b => b.id));
  }

  deviceQuery += ' ORDER BY d.id DESC';
  spareQuery += ' ORDER BY a.asset_code ASC';

  const devices = db.prepare(deviceQuery).all(...params);
  const spareAssets = db.prepare(spareQuery).all(...spareParams);

  res.render('devices', {
    title: 'Master Devices',
    activeMenu: 'devices',
    devices,
    spareAssets,
    successMsg: req.query.success || null,
    errorMsg: req.query.error || null
  });
};

exports.store = (req, res) => {
  const {
    asset_id, hostname, switch_management, is_poe, ip_address, room_location,
    port_layout, faceplate_template,
    rj45_count, rj45_capacity, sfp_count, sfp_capacity, sfp_plus_count,
    sfp_plus_capacity, qsfp_plus_count, qsfp_plus_capacity, qsfp28_count, qsfp28_capacity
  } = req.body;

  if (!asset_id) {
    return res.redirect('/devices?error=Silakan+pilih+unit+aset+dari+Master+Assets+terlebih+dahulu');
  }

  const targetAssetId = Number(asset_id);
  const existingAsset = db.prepare(`
    SELECT a.*, dt.is_switch, br.brand_name, dm.model_name
    FROM assets a
    JOIN device_types dt ON a.device_type_id = dt.id
    LEFT JOIN brands br ON a.brand_id = br.id
    LEFT JOIN device_models dm ON a.model_id = dm.id
    WHERE a.id = ?
  `).get(targetAssetId);

  if (!existingAsset) {
    return res.redirect('/devices?error=Data+aset+tidak+ditemukan');
  }

  if (existingAsset.status !== 'spare') {
    return res.redirect(`/devices?error=Aset+${encodeURIComponent(existingAsset.asset_code)}+tidak+berstatus+Spare`);
  }

  if (!hostname || hostname.trim() === '') {
    return res.redirect('/devices?error=Hostname+perangkat+wajib+diisi');
  }

  if (!req.canAccessBranch(existingAsset.branch_id)) {
    return res.status(403).render('forbidden', {
      title: '403 Akses Ditolak',
      message: 'Anda tidak memiliki hak akses untuk memasang perangkat di cabang tersebut.'
    });
  }

  const isSwitch = existingAsset.is_switch === 1;

  let newDeviceId;
  const insertTransaction = db.transaction(() => {
    db.prepare(`UPDATE assets SET status = 'active' WHERE id = ?`).run(targetAssetId);

    db.prepare(`
      INSERT INTO asset_movements (
        asset_id, movement_type, from_branch_id, to_branch_id,
        from_location, to_location, moved_by, notes
      ) VALUES (?, 'DEPLOY', ?, ?, 'Gudang / Spare', ?, ?, ?)
    `).run(
      targetAssetId,
      existingAsset.branch_id,
      existingAsset.branch_id,
      room_location || '-',
      req.user.full_name,
      `Dipasang ke jaringan sebagai ${hostname.trim()} (${ip_address || 'No IP'})`
    );

    const info = db.prepare(`
      INSERT INTO devices (
        asset_id, branch_id, device_type_id, brand_id, model_id, hostname, brand, model,
        switch_management, is_poe, ip_address, mac_address, serial_number,
        room_location, port_layout, faceplate_template, physical_photo, sn_photo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      targetAssetId,
      existingAsset.branch_id,
      existingAsset.device_type_id,
      existingAsset.brand_id,
      existingAsset.model_id,
      hostname.trim(),
      existingAsset.brand_name || null,
      existingAsset.model_name || null,
      isSwitch ? switch_management : null,
      isSwitch && is_poe === '1' ? 1 : 0,
      (isSwitch && switch_management === 'Unmanaged') ? null : (ip_address || null),
      existingAsset.mac_address || null,
      existingAsset.serial_number || null,
      room_location || null,
      port_layout || '2_row',
      faceplate_template || 'rackmount',
      existingAsset.physical_photo || null,
      existingAsset.sn_photo || null
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
    branchId: existingAsset.branch_id,
    description: `Memasang aset ${existingAsset.asset_code} ke jaringan sebagai "${hostname.trim()}".`
  });

  res.redirect('/devices?success=Perangkat+berhasil+dipasang+ke+topologi');
};

exports.update = (req, res) => {
  const deviceId = req.params.id;
  const existingDevice = db.prepare(`
    SELECT d.*, dt.is_switch
    FROM devices d
    JOIN device_types dt ON d.device_type_id = dt.id
    WHERE d.id = ?
  `).get(deviceId);

  if (!existingDevice) return res.redirect('/devices');

  if (!req.canAccessBranch(existingDevice.branch_id)) {
    return res.status(403).render('forbidden', {
      title: '403 Akses Ditolak',
      message: 'Anda tidak memiliki hak akses untuk mengubah perangkat pada cabang tersebut.'
    });
  }

  const {
    hostname, switch_management, is_poe, ip_address, room_location,
    port_layout, faceplate_template,
    rj45_count, rj45_capacity, sfp_count, sfp_capacity, sfp_plus_count,
    sfp_plus_capacity, qsfp_plus_count, qsfp_plus_capacity, qsfp28_count, qsfp28_capacity
  } = req.body;

  const isSwitch = existingDevice.is_switch === 1;

  const updateTransaction = db.transaction(() => {
    db.prepare(`
      UPDATE devices SET
        hostname = ?, switch_management = ?, is_poe = ?, ip_address = ?,
        room_location = ?, port_layout = ?, faceplate_template = ?
      WHERE id = ?
    `).run(
      hostname.trim(),
      isSwitch ? switch_management : null,
      isSwitch && is_poe === '1' ? 1 : 0,
      (isSwitch && switch_management === 'Unmanaged') ? null : (ip_address || null),
      room_location || null,
      port_layout || '2_row',
      faceplate_template || 'rackmount',
      deviceId
    );

    if (existingDevice.asset_id) {
      const roomChanged = (existingDevice.room_location || '') !== (room_location || '');
      if (roomChanged) {
        db.prepare(`
          INSERT INTO asset_movements (
            asset_id, movement_type, from_branch_id, to_branch_id,
            from_location, to_location, moved_by, notes
          ) VALUES (?, 'PINDAH_RUANG', ?, ?, ?, ?, ?, ?)
        `).run(
          existingDevice.asset_id,
          existingDevice.branch_id,
          existingDevice.branch_id,
          existingDevice.room_location || '-',
          room_location || '-',
          req.user.full_name,
          `Perubahan ruangan penempatan pada perangkat ${hostname.trim()}`
        );
      }
    }

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
    branchId: existingDevice.branch_id,
    description: `Memperbarui konfigurasi perangkat "${hostname.trim()}" (IP: ${ip_address || '-'}).`
  });

  res.redirect('/devices?success=Konfigurasi+perangkat+berhasil+diperbarui');
};

exports.destroy = (req, res) => {
  const device = db.prepare('SELECT id, asset_id, branch_id, hostname, room_location FROM devices WHERE id = ?').get(req.params.id);
  if (!device) return res.redirect('/devices');

  if (!req.canAccessBranch(device.branch_id)) {
    return res.status(403).render('forbidden', {
      title: '403 Akses Ditolak',
      message: 'Anda tidak memiliki hak akses untuk menghapus perangkat di cabang ini.'
    });
  }

  db.transaction(() => {
    if (device.asset_id) {
      db.prepare(`UPDATE assets SET status = 'spare' WHERE id = ?`).run(device.asset_id);
      db.prepare(`
        INSERT INTO asset_movements (
          asset_id, movement_type, from_branch_id, to_branch_id,
          from_location, to_location, moved_by, notes
        ) VALUES (?, 'DISMANTLE', ?, ?, ?, 'Gudang / Spare', ?, ?)
      `).run(
        device.asset_id,
        device.branch_id,
        device.branch_id,
        device.room_location || '-',
        req.user.full_name,
        `Dilepas dari perangkat jaringan (${device.hostname})`
      );
    }

    db.prepare('DELETE FROM devices WHERE id = ?').run(req.params.id);
  })();

  logAudit(req, {
    action: 'DELETE',
    entityType: 'device',
    entityId: device.id,
    branchId: device.branch_id,
    description: `Menghapus perangkat "${device.hostname}" dari jaringan (aset dikembalikan ke status Spare).`
  });

  res.redirect('/devices?success=Perangkat+dibongkar+dari+jaringan+dan+aset+kembali+ke+stok+Spare');
};