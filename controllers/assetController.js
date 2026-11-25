const db = require('../db');
const fs = require('fs');
const path = require('path');
const { getAssetSettings, generateNextAssetCode } = require('../utils/assetCodeHelper');
const { logAudit } = require('../utils/auditLogger');

function deleteFileIfExists(publicRelativePath) {
  if (!publicRelativePath) return;
  const cleanRel = publicRelativePath.startsWith('/') ? publicRelativePath.slice(1) : publicRelativePath;
  const filePath = path.join(__dirname, '..', 'public', cleanRel);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (e) {}
  }
}

function renamePhotoWithAssetCode(uploadedFile, assetCode, suffixType) {
  if (!uploadedFile) return null;

  const safeCode = String(assetCode || 'ASSET')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const ext = path.extname(uploadedFile.originalname || uploadedFile.filename || '.jpg').toLowerCase() || '.jpg';
  const newFilename = `${safeCode}_${suffixType}_${Date.now()}${ext}`;
  const oldPath = uploadedFile.path;
  const newPath = path.join(path.dirname(oldPath), newFilename);

  try {
    fs.renameSync(oldPath, newPath);
    return '/uploads/' + newFilename;
  } catch (e) {
    return '/uploads/' + uploadedFile.filename;
  }
}

function copyAuditEvidencePhoto(existingPublicPath, assetCode) {
  if (!existingPublicPath) return null;
  const cleanRel = existingPublicPath.startsWith('/') ? existingPublicPath.slice(1) : existingPublicPath;
  const srcPath = path.join(__dirname, '..', 'public', cleanRel);
  if (!fs.existsSync(srcPath)) return existingPublicPath;

  const safeCode = String(assetCode || 'ASSET')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const ext = path.extname(srcPath).toLowerCase() || '.jpg';
  const newFilename = `${safeCode}_FISIK_${Date.now()}${ext}`;
  const destPath = path.join(path.dirname(srcPath), newFilename);

  try {
    fs.copyFileSync(srcPath, destPath);
    return '/uploads/' + newFilename;
  } catch (e) {
    return existingPublicPath;
  }
}

// 1. GET /assets - Daftar Master Aset & Statistik
exports.listAssets = (req, res) => {
  const selectedBranchId = req.selectedBranchId || 'all';
  const branches = req.accessibleBranches || [];

  let branchFilterSql = '';
  const params = [];

  if (selectedBranchId === 'none' || branches.length === 0) {
    branchFilterSql = 'WHERE 1 = 0';
  } else if (selectedBranchId !== 'all') {
    branchFilterSql = 'WHERE a.branch_id = ?';
    params.push(selectedBranchId);
  } else {
    const placeholders = branches.map(() => '?').join(',');
    branchFilterSql = `WHERE a.branch_id IN (${placeholders})`;
    params.push(...branches.map(b => b.id));
  }

  const assets = db.prepare(`
    SELECT
      a.*,
      b.branch_code,
      b.branch_name,
      dt.type_name,
      br.brand_name,
      dm.model_name,
      d.id AS linked_device_id,
      d.hostname AS linked_hostname,
      d.ip_address AS linked_ip,
      d.room_location AS linked_location
    FROM assets a
    LEFT JOIN branches b ON a.branch_id = b.id
    LEFT JOIN device_types dt ON a.device_type_id = dt.id
    LEFT JOIN brands br ON a.brand_id = br.id
    LEFT JOIN device_models dm ON a.model_id = dm.id
    LEFT JOIN devices d ON d.asset_id = a.id
    ${branchFilterSql}
    ORDER BY a.id DESC
  `).all(...params);

  const stats = {
    total: assets.length,
    active: assets.filter(a => a.status === 'active').length,
    spare: assets.filter(a => a.status === 'spare').length,
    issue: assets.filter(a => ['maintenance', 'broken'].includes(a.status)).length,
    totalValue: assets.reduce((sum, a) => sum + (Number(a.purchase_price) || 0), 0)
  };

  const globalCountRow = db.prepare(`SELECT COUNT(*) AS total FROM assets`).get();
  const totalAssetCount = globalCountRow ? Number(globalCountRow.total) : 0;

  const deviceTypes = db.prepare(`SELECT * FROM device_types ORDER BY type_name ASC`).all();
  const brands = db.prepare(`SELECT * FROM brands ORDER BY brand_name ASC`).all();
  const models = db.prepare(`SELECT * FROM device_models ORDER BY model_name ASC`).all();
  const settings = getAssetSettings();

  // Cek jika ada permintaan pendaftaran dari temuan audit unregistered (?register_audit_item=ID)
  let auditPrefillItem = null;
  if (req.query.register_audit_item) {
    const auditItemId = Number(req.query.register_audit_item);
    if (auditItemId) {
      auditPrefillItem = db.prepare(`
        SELECT
          i.*,
          au.id AS audit_id,
          au.audit_code,
          au.branch_id AS audit_branch_id,
          b.branch_code AS audit_branch_code,
          b.branch_name AS audit_branch_name
        FROM asset_audit_items i
        JOIN asset_audits au ON i.audit_id = au.id
        LEFT JOIN branches b ON au.branch_id = b.id
        WHERE i.id = ? AND i.finding_type = 'unregistered'
      `).get(auditItemId) || null;
    }
  }

  const previewBranchId = auditPrefillItem
    ? auditPrefillItem.audit_branch_id
    : (selectedBranchId !== 'all' && selectedBranchId !== 'none'
      ? selectedBranchId
      : (branches[0] ? branches[0].id : 1));
  const sampleAssetCode = generateNextAssetCode(previewBranchId);

  res.render('assets/assets', {
    title: 'Master Assets',
    activeMenu: 'assets',
    assets,
    stats,
    totalAssetCount,
    branches,
    selectedBranchId,
    deviceTypes,
    brands,
    models,
    settings,
    sampleAssetCode,
    auditPrefillItem,
    successMsg: req.query.success || null,
    errorMsg: req.query.error || null
  });
};

// 2. GET /assets/:id - Detail Profil & Riwayat Mutasi + Maintenance
exports.detailAsset = (req, res) => {
  const assetId = req.params.id;
  const asset = db.prepare(`
    SELECT
      a.*,
      b.branch_code,
      b.branch_name,
      dt.type_name,
      br.brand_name,
      dm.model_name,
      d.id AS linked_device_id,
      d.hostname AS linked_hostname,
      d.ip_address AS linked_ip,
      d.room_location AS linked_location
    FROM assets a
    LEFT JOIN branches b ON a.branch_id = b.id
    LEFT JOIN device_types dt ON a.device_type_id = dt.id
    LEFT JOIN brands br ON a.brand_id = br.id
    LEFT JOIN device_models dm ON a.model_id = dm.id
    LEFT JOIN devices d ON d.asset_id = a.id
    WHERE a.id = ?
  `).get(assetId);

  if (!asset) {
    return res.redirect('/assets?error=Data+aset+tidak+ditemukan');
  }

  if (!req.canAccessBranch(asset.branch_id)) {
    return res.status(403).render('forbidden', {
      title: '403 Akses Ditolak',
      message: 'Anda tidak memiliki hak akses untuk melihat aset pada cabang tersebut.'
    });
  }

  const movements = db.prepare(`
    SELECT
      m.*,
      fb.branch_code AS from_branch_code,
      fb.branch_name AS from_branch_name,
      tb.branch_code AS to_branch_code,
      tb.branch_name AS to_branch_name
    FROM asset_movements m
    LEFT JOIN branches fb ON m.from_branch_id = fb.id
    LEFT JOIN branches tb ON m.to_branch_id = tb.id
    WHERE m.asset_id = ?
    ORDER BY m.id DESC
  `).all(assetId);

  const maintenances = db.prepare(`
    SELECT * FROM asset_maintenances
    WHERE asset_id = ?
    ORDER BY id DESC
  `).all(assetId);

  const branches = req.accessibleBranches || [];
  const allBranches = db.prepare(`SELECT id, branch_code, branch_name FROM branches ORDER BY branch_code ASC`).all();
  const settings = getAssetSettings();

  res.render('assets/asset-detail', {
    title: `Detail Aset ${asset.asset_code}`,
    activeMenu: 'assets',
    asset,
    movements,
    maintenances,
    branches,
    allBranches,
    settings,
    successMsg: req.query.success || null,
    errorMsg: req.query.error || null
  });
};

// 3. POST /assets - Tambah Aset Baru (Termasuk Promosi dari Temuan Audit Unregistered)
exports.createAsset = (req, res) => {
  try {
    const {
      code_mode,
      manual_asset_code,
      branch_id,
      device_type_id,
      brand_id,
      model_id,
      serial_number,
      mac_address,
      status,
      condition,
      purchase_date,
      warranty_end,
      vendor_name,
      purchase_price,
      notes,
      from_audit_item_id
    } = req.body;

    const auditItemId = from_audit_item_id ? Number(from_audit_item_id) : null;
    const auditItem = auditItemId
      ? db.prepare(`
          SELECT i.*, au.id AS audit_id, au.audit_code
          FROM asset_audit_items i
          JOIN asset_audits au ON i.audit_id = au.id
          WHERE i.id = ? AND i.finding_type = 'unregistered'
        `).get(auditItemId)
      : null;

    const errorRedirectBase = auditItem
      ? `/assets?register_audit_item=${auditItem.id}&error=`
      : '/assets?error=';

    if (!branch_id || !device_type_id) {
      return res.redirect(`${errorRedirectBase}${encodeURIComponent('Cabang dan Jenis Perangkat wajib diisi')}`);
    }

    if (!req.canAccessBranch(branch_id)) {
      return res.status(403).render('forbidden', {
        title: '403 Akses Ditolak',
        message: 'Anda tidak memiliki hak akses untuk menambah aset pada cabang tersebut.'
      });
    }

    const finalAssetCode =
      code_mode === 'manual' && manual_asset_code && manual_asset_code.trim() !== ''
        ? manual_asset_code.trim().toUpperCase()
        : generateNextAssetCode(branch_id, purchase_date || null);

    const existingCode = db.prepare(`SELECT id FROM assets WHERE asset_code = ?`).get(finalAssetCode);
    if (existingCode) {
      return res.redirect(`${errorRedirectBase}${encodeURIComponent(`Kode aset ${finalAssetCode} sudah terdaftar`)}`);
    }

    const cleanSN = serial_number && serial_number.trim() !== '' ? serial_number.trim() : null;
    if (cleanSN) {
      const existingSN = db.prepare(`SELECT id FROM assets WHERE serial_number = ?`).get(cleanSN);
      if (existingSN) {
        return res.redirect(`${errorRedirectBase}${encodeURIComponent(`Serial Number ${cleanSN} sudah terdaftar pada aset lain`)}`);
      }
    }

    // Penamaan file foto berdasarkan Kode Inventaris (jika tidak upload baru, pakai foto bukti audit jika ada)
    let physicalPhoto = req.files?.['physical_photo']
      ? renamePhotoWithAssetCode(req.files['physical_photo'][0], finalAssetCode, 'FISIK')
      : null;
    if (!physicalPhoto && auditItem && auditItem.photo_evidence) {
      physicalPhoto = copyAuditEvidencePhoto(auditItem.photo_evidence, finalAssetCode);
    }

    const snPhoto = req.files?.['sn_photo']
      ? renamePhotoWithAssetCode(req.files['sn_photo'][0], finalAssetCode, 'SN')
      : null;

    const finalStatus = status || 'spare';
    const finalCondition = condition || 'good';

    const insertTx = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO assets (
          asset_code, branch_id, device_type_id, brand_id, model_id,
          serial_number, mac_address, status, condition,
          purchase_date, warranty_end, vendor_name, purchase_price,
          physical_photo, sn_photo, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        finalAssetCode,
        branch_id,
        device_type_id,
        brand_id || null,
        model_id || null,
        cleanSN,
        mac_address ? mac_address.trim() : null,
        finalStatus,
        finalCondition,
        purchase_date || null,
        warranty_end || null,
        vendor_name ? vendor_name.trim() : null,
        parseInt(purchase_price, 10) || 0,
        physicalPhoto,
        snPhoto,
        notes ? notes.trim() : null
      );

      const newAssetId = info.lastInsertRowid;

      db.prepare(`
        INSERT INTO asset_movements (
          asset_id, movement_type, to_branch_id, to_location, moved_by, notes
        ) VALUES (?, 'MASUK_GUDANG', ?, 'Gudang / Inventaris Cabang', ?, ?)
      `).run(
        newAssetId,
        branch_id,
        req.user.full_name,
        auditItem
          ? `Registrasi aset dari temuan Audit ${auditItem.audit_code} (${finalAssetCode})`
          : `Registrasi aset baru (${finalAssetCode})`
      );

      // Jika berasal dari temuan audit unregistered, tautkan ke asset_audit_items
      if (auditItem) {
        const isDamaged = finalStatus === 'broken' || finalCondition === 'damaged' || finalCondition === 'fair';
        const auditCondLabel = finalCondition === 'damaged'
          ? 'rusak_berat'
          : (finalCondition === 'fair' ? 'rusak_ringan' : 'baik');
        const nextFindingType = isDamaged ? 'condition_mismatch' : 'matched';

        db.prepare(`
          UPDATE asset_audit_items
          SET asset_id = ?,
              expected_branch_id = ?,
              expected_status = ?,
              expected_condition = ?,
              actual_condition = ?,
              finding_type = ?,
              notes = ?
          WHERE id = ?
        `).run(
          newAssetId,
          branch_id,
          finalStatus,
          auditCondLabel,
          auditCondLabel,
          nextFindingType,
          notes ? notes.trim() : auditItem.notes,
          auditItem.id
        );
      }

      return newAssetId;
    });

    const newId = insertTx();

    logAudit(req, {
      branchId: branch_id,
      action: 'CREATE',
      entityType: 'asset',
      entityId: newId,
      description: auditItem
        ? `Mendaftarkan temuan audit ${auditItem.audit_code} menjadi aset baru: ${finalAssetCode} (SN: ${cleanSN || '-'})`
        : `Menambahkan aset baru: ${finalAssetCode} (SN: ${cleanSN || '-'})`
    });

    if (auditItem) {
      return res.redirect(
        `/assets/audits/${auditItem.audit_id}?msg=` +
        encodeURIComponent(`Temuan audit berhasil didaftarkan ke Master Aset dengan kode ${finalAssetCode}.`)
      );
    }

    res.redirect(`/assets?success=Aset+${encodeURIComponent(finalAssetCode)}+berhasil+ditambahkan`);
  } catch (err) {
    console.error(err);
    res.redirect('/assets?error=Gagal+menambahkan+data+aset');
  }
};

// 4. POST /assets/:id/update - Edit Data Administrasi & Fisik Aset
exports.updateAsset = (req, res) => {
  try {
    const assetId = req.params.id;
    const oldAsset = db.prepare(`SELECT * FROM assets WHERE id = ?`).get(assetId);
    if (!oldAsset) {
      return res.redirect('/assets?error=Aset+tidak+ditemukan');
    }

    if (!req.canAccessBranch(oldAsset.branch_id)) {
      return res.status(403).render('forbidden', {
        title: '403 Akses Ditolak',
        message: 'Anda tidak memiliki hak akses untuk mengubah aset pada cabang tersebut.'
      });
    }

    const {
      asset_code,
      device_type_id,
      brand_id,
      model_id,
      serial_number,
      mac_address,
      status,
      condition,
      purchase_date,
      warranty_end,
      vendor_name,
      purchase_price,
      notes
    } = req.body;

    const cleanCode = asset_code ? asset_code.trim().toUpperCase() : oldAsset.asset_code;
    const dupCode = db.prepare(`SELECT id FROM assets WHERE asset_code = ? AND id != ?`).get(cleanCode, assetId);
    if (dupCode) {
      return res.redirect('/assets?error=Kode+aset+sudah+digunakan+oleh+unit+lain');
    }

    const cleanSN = serial_number && serial_number.trim() !== '' ? serial_number.trim() : null;
    if (cleanSN) {
      const dupSN = db.prepare(`SELECT id FROM assets WHERE serial_number = ? AND id != ?`).get(cleanSN, assetId);
      if (dupSN) {
        return res.redirect('/assets?error=Serial+Number+sudah+digunakan+oleh+unit+lain');
      }
    }

    let physicalPhoto = oldAsset.physical_photo;
    if (req.files?.['physical_photo']) {
      deleteFileIfExists(oldAsset.physical_photo);
      physicalPhoto = renamePhotoWithAssetCode(req.files['physical_photo'][0], cleanCode, 'FISIK');
    }

    let snPhoto = oldAsset.sn_photo;
    if (req.files?.['sn_photo']) {
      deleteFileIfExists(oldAsset.sn_photo);
      snPhoto = renamePhotoWithAssetCode(req.files['sn_photo'][0], cleanCode, 'SN');
    }

    const linkedDevice = db.prepare(`SELECT * FROM devices WHERE asset_id = ?`).get(assetId);
    const requestedStatus = status || oldAsset.status;
    const newStatus = (!linkedDevice && requestedStatus === 'active') ? 'spare' : requestedStatus;

    const parsedBrandId = brand_id ? Number(brand_id) : null;
    const parsedModelId = model_id ? Number(model_id) : null;
    const brandRow = parsedBrandId ? db.prepare('SELECT brand_name FROM brands WHERE id = ?').get(parsedBrandId) : null;
    const modelRow = parsedModelId ? db.prepare('SELECT model_name FROM device_models WHERE id = ?').get(parsedModelId) : null;

    db.transaction(() => {
      db.prepare(`
        UPDATE assets SET
          asset_code = ?,
          device_type_id = ?,
          brand_id = ?,
          model_id = ?,
          serial_number = ?,
          mac_address = ?,
          status = ?,
          condition = ?,
          purchase_date = ?,
          warranty_end = ?,
          vendor_name = ?,
          purchase_price = ?,
          physical_photo = ?,
          sn_photo = ?,
          notes = ?
        WHERE id = ?
      `).run(
        cleanCode,
        device_type_id || oldAsset.device_type_id,
        parsedBrandId,
        parsedModelId,
        cleanSN,
        mac_address ? mac_address.trim() : null,
        newStatus,
        condition || oldAsset.condition,
        purchase_date || null,
        warranty_end || null,
        vendor_name ? vendor_name.trim() : null,
        parseInt(purchase_price, 10) || 0,
        physicalPhoto,
        snPhoto,
        notes ? notes.trim() : null,
        assetId
      );

      if (linkedDevice) {
        if (newStatus !== 'active') {
          db.prepare(`
            INSERT INTO asset_movements (
              asset_id, movement_type, from_branch_id, to_branch_id,
              from_location, to_location, moved_by, notes
            ) VALUES (?, 'DISMANTLE', ?, ?, ?, 'Gudang / Service', ?, ?)
          `).run(
            assetId,
            oldAsset.branch_id,
            oldAsset.branch_id,
            linkedDevice.room_location || '-',
            req.user.full_name,
            `Status aset diubah menjadi ${newStatus.toUpperCase()} (dilepas dari ${linkedDevice.hostname})`
          );
          db.prepare(`DELETE FROM devices WHERE id = ?`).run(linkedDevice.id);
        } else {
          db.prepare(`
            UPDATE devices SET
              device_type_id = ?,
              brand_id = ?,
              model_id = ?,
              brand = ?,
              model = ?,
              serial_number = ?,
              mac_address = ?,
              physical_photo = ?,
              sn_photo = ?
            WHERE asset_id = ?
          `).run(
            device_type_id || oldAsset.device_type_id,
            parsedBrandId,
            parsedModelId,
            brandRow ? brandRow.brand_name : null,
            modelRow ? modelRow.model_name : null,
            cleanSN,
            mac_address ? mac_address.trim() : null,
            physicalPhoto,
            snPhoto,
            assetId
          );
        }
      }
    })();

    logAudit(req, {
      branchId: oldAsset.branch_id,
      action: 'UPDATE',
      entityType: 'asset',
      entityId: assetId,
      description: `Memperbarui data aset: ${cleanCode}`
    });

    const redirectTarget = req.body.redirect_to || '/assets';
    res.redirect(`${redirectTarget}?success=Data+aset+${encodeURIComponent(cleanCode)}+berhasil+diperbarui`);
  } catch (err) {
    console.error(err);
    res.redirect('/assets?error=Gagal+memperbarui+data+aset');
  }
};

// 4b. POST /assets/:id/delete-photo - Hapus Foto Fisik atau Foto SN Aset
exports.deleteAssetPhoto = (req, res) => {
  try {
    const assetId = req.params.id;
    const { photo_type } = req.body;

    const asset = db.prepare(`SELECT * FROM assets WHERE id = ?`).get(assetId);
    if (!asset) {
      return res.redirect('/assets?error=Aset+tidak+ditemukan');
    }

    if (!req.canAccessBranch(asset.branch_id)) {
      return res.status(403).render('forbidden', {
        title: '403 Akses Ditolak',
        message: 'Anda tidak memiliki hak akses untuk menghapus foto aset pada cabang tersebut.'
      });
    }

    if (photo_type !== 'physical' && photo_type !== 'sn') {
      return res.redirect('/assets?error=Tipe+foto+tidak+valid');
    }

    const column = photo_type === 'physical' ? 'physical_photo' : 'sn_photo';
    const currentPhotoPath = asset[column];

    deleteFileIfExists(currentPhotoPath);

    db.transaction(() => {
      db.prepare(`UPDATE assets SET ${column} = NULL WHERE id = ?`).run(assetId);
      db.prepare(`UPDATE devices SET ${column} = NULL WHERE asset_id = ?`).run(assetId);
    })();

    logAudit(req, {
      branchId: asset.branch_id,
      action: 'DELETE',
      entityType: 'asset_photo',
      entityId: assetId,
      description: `Menghapus foto ${photo_type === 'physical' ? 'fisik' : 'SN'} aset ${asset.asset_code}`
    });

    const redirectTarget = req.body.redirect_to || '/assets';
    const labelJenis = photo_type === 'physical' ? 'Foto+fisik' : 'Foto+SN';
    res.redirect(`${redirectTarget}?success=${labelJenis}+aset+${encodeURIComponent(asset.asset_code)}+berhasil+dihapus`);
  } catch (err) {
    console.error(err);
    res.redirect('/assets?error=Gagal+menghapus+foto+aset');
  }
};

// 5. POST /assets/:id/move - Mutasi Cabang / Pindah Lokasi / Tarik ke Gudang
exports.moveAsset = (req, res) => {
  try {
    const assetId = req.params.id || req.body.asset_id;
    const asset = db.prepare(`SELECT * FROM assets WHERE id = ?`).get(assetId);
    if (!asset) return res.redirect('/assets?error=Aset+tidak+ditemukan');

    if (!req.canAccessBranch(asset.branch_id)) {
      return res.status(403).render('forbidden', {
        title: '403 Akses Ditolak',
        message: 'Anda tidak memiliki hak akses pada cabang aset asal ini.'
      });
    }

    const { movement_type, to_branch_id, to_location, notes } = req.body;
    const targetBranchId = to_branch_id ? parseInt(to_branch_id, 10) : asset.branch_id;

    const targetBranch = db.prepare(`SELECT id FROM branches WHERE id = ?`).get(targetBranchId);
    if (!targetBranch) {
      const errRedirect = req.body.redirect_to || '/asset-movements';
      return res.redirect(`${errRedirect}?error=Cabang+tujuan+mutasi+tidak+valid`);
    }

    const linkedDevice = db.prepare(`SELECT * FROM devices WHERE asset_id = ?`).get(assetId);

    db.transaction(() => {
      db.prepare(`
        INSERT INTO asset_movements (
          asset_id, movement_type, from_branch_id, to_branch_id,
          from_location, to_location, moved_by, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        assetId,
        movement_type || 'MUTASI_CABANG',
        asset.branch_id,
        targetBranchId,
        linkedDevice ? linkedDevice.room_location : 'Gudang',
        to_location || '-',
        req.user.full_name,
        notes || null
      );

      let nextStatus = asset.status;
      if (movement_type === 'DISMANTLE') nextStatus = 'spare';
      if (movement_type === 'DISPOSAL') nextStatus = 'disposed';

      db.prepare(`UPDATE assets SET branch_id = ?, status = ? WHERE id = ?`).run(
        targetBranchId,
        nextStatus,
        assetId
      );

      if (linkedDevice) {
        if (movement_type === 'DISMANTLE' || movement_type === 'DISPOSAL') {
          db.prepare(`DELETE FROM devices WHERE id = ?`).run(linkedDevice.id);
        } else {
          db.prepare(`UPDATE devices SET branch_id = ?, room_location = ? WHERE id = ?`).run(
            targetBranchId,
            to_location || linkedDevice.room_location,
            linkedDevice.id
          );
        }
      }
    })();

    logAudit(req, {
      branchId: targetBranchId,
      action: 'UPDATE',
      entityType: 'asset',
      entityId: assetId,
      description: `Mutasi aset ${asset.asset_code} (${movement_type})`
    });

    let redirectTarget = req.body.redirect_to || `/assets/${assetId}`;
    if (redirectTarget === `/assets/${assetId}` && !req.canAccessBranch(targetBranchId)) {
      redirectTarget = '/asset-movements';
    }

    res.redirect(`${redirectTarget}?success=Riwayat+mutasi+aset+berhasil+dicatat`);
  } catch (err) {
    console.error(err);
    res.redirect('/assets?error=Gagal+mencatat+mutasi+aset');
  }
};

// 6. POST /assets/:id/maintenance - Catat Log Perbaikan / Service
exports.addMaintenance = (req, res) => {
  try {
    const assetId = req.params.id || req.body.asset_id;
    const asset = db.prepare(`SELECT * FROM assets WHERE id = ?`).get(assetId);
    if (!asset) return res.redirect('/assets?error=Aset+tidak+ditemukan');

    if (!req.canAccessBranch(asset.branch_id)) {
      return res.status(403).render('forbidden', {
        title: '403 Akses Ditolak',
        message: 'Anda tidak memiliki hak akses pada cabang aset ini.'
      });
    }

    const {
      issue_date,
      resolved_date,
      problem_description,
      action_taken,
      service_vendor,
      cost,
      maintenance_status,
      asset_status_after
    } = req.body;

    const linkedDevice = db.prepare(`SELECT * FROM devices WHERE asset_id = ?`).get(assetId);

    db.transaction(() => {
      db.prepare(`
        INSERT INTO asset_maintenances (
          asset_id, issue_date, resolved_date, problem_description,
          action_taken, service_vendor, cost, status, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        assetId,
        issue_date,
        resolved_date || null,
        problem_description,
        action_taken || null,
        service_vendor || 'Internal IT',
        parseInt(cost, 10) || 0,
        maintenance_status || 'open',
        req.user.full_name
      );

      if (asset_status_after) {
        const finalAfterStatus = (!linkedDevice && asset_status_after === 'active') ? 'spare' : asset_status_after;
        const nextCond = finalAfterStatus === 'broken' ? 'damaged' : asset.condition;
        db.prepare(`UPDATE assets SET status = ?, condition = ? WHERE id = ?`).run(
          finalAfterStatus,
          nextCond,
          assetId
        );

        if (linkedDevice && finalAfterStatus !== 'active') {
          db.prepare(`DELETE FROM devices WHERE id = ?`).run(linkedDevice.id);
        }
      }
    })();

    logAudit(req, {
      branchId: asset.branch_id,
      action: 'CREATE',
      entityType: 'asset_maintenance',
      entityId: assetId,
      description: `Mencatat perbaikan aset ${asset.asset_code}: ${problem_description}`
    });

    const redirectTarget = req.body.redirect_to || `/assets/${assetId}`;
    res.redirect(`${redirectTarget}?success=Catatan+perbaikan+aset+berhasil+disimpan`);
  } catch (err) {
    console.error(err);
    res.redirect('/assets?error=Gagal+menyimpan+catatan+perbaikan');
  }
};

// 7. POST /assets/:id/delete - Hapus Aset
exports.deleteAsset = (req, res) => {
  try {
    const assetId = req.params.id;
    const asset = db.prepare(`SELECT * FROM assets WHERE id = ?`).get(assetId);
    if (!asset) return res.redirect('/assets?error=Aset+tidak+ditemukan');

    if (!req.canAccessBranch(asset.branch_id)) {
      return res.status(403).render('forbidden', {
        title: '403 Akses Ditolak',
        message: 'Anda tidak memiliki hak akses untuk menghapus aset di cabang ini.'
      });
    }

    const linkedDevice = db.prepare(`SELECT hostname FROM devices WHERE asset_id = ?`).get(assetId);
    if (linkedDevice) {
      return res.redirect(
        `/assets?error=Aset+masih+terpasang+pada+perangkat+${encodeURIComponent(linkedDevice.hostname)}.+Hapus/bongkar+perangkat+terlebih+dahulu.`
      );
    }

    deleteFileIfExists(asset.physical_photo);
    deleteFileIfExists(asset.sn_photo);

    db.prepare(`DELETE FROM assets WHERE id = ?`).run(assetId);

    logAudit(req, {
      branchId: asset.branch_id,
      action: 'DELETE',
      entityType: 'asset',
      entityId: assetId,
      description: `Menghapus data aset: ${asset.asset_code}`
    });

    res.redirect(`/assets?success=Aset+${encodeURIComponent(asset.asset_code)}+berhasil+dihapus`);
  } catch (err) {
    console.error(err);
    res.redirect('/assets?error=Gagal+menghapus+aset');
  }
};

// 8. POST /assets/settings - Update Format Kode Aset & Nama Instansi
exports.updateAssetSettings = (req, res) => {
  try {
    const { asset_code_format, organization_name } = req.body;
    const currentSettings = getAssetSettings();

    const globalCountRow = db.prepare(`SELECT COUNT(*) AS total FROM assets`).get();
    const totalAssetCount = globalCountRow ? Number(globalCountRow.total) : 0;

    const upsert = db.prepare(`
      INSERT INTO app_settings (setting_key, setting_value, updated_at)
      VALUES (?, ?, datetime('now', '+7 hours'))
      ON CONFLICT(setting_key) DO UPDATE SET
        setting_value = excluded.setting_value,
        updated_at = excluded.updated_at
    `);

    if (organization_name && organization_name.trim() !== '') {
      upsert.run('organization_name', organization_name.trim());
    }

    const isFormatChanged = asset_code_format && asset_code_format.trim() !== currentSettings.asset_code_format;
    if (totalAssetCount === 0 && asset_code_format && asset_code_format.trim() !== '') {
      upsert.run('asset_code_format', asset_code_format.trim());
    }

    logAudit(req, {
      action: 'UPDATE',
      entityType: 'settings',
      description: totalAssetCount > 0
        ? `Memperbarui nama instansi menjadi: ${organization_name} (pola kode aset terkunci)`
        : `Mengubah pengaturan aset (Instansi: ${organization_name}, Format: ${asset_code_format})`
    });

    if (totalAssetCount > 0 && isFormatChanged) {
      return res.redirect('/assets?success=Nama+instansi+diperbarui.+Format+kode+aset+tetap+dikunci+karena+sudah+ada+data+aset+terdaftar.');
    }

    res.redirect('/assets?success=Pengaturan+aset+berhasil+disimpan');
  } catch (err) {
    console.error(err);
    res.redirect('/assets?error=Gagal+menyimpan+pengaturan+aset');
  }
};

// 9. GET /asset-movements - Menu Khusus Riwayat Mutasi & Distribusi Aset
exports.listMovements = (req, res) => {
  const selectedBranchId = req.selectedBranchId || 'all';
  const branches = req.accessibleBranches || [];

  let branchFilterSql = '';
  const params = [];

  if (selectedBranchId === 'none' || branches.length === 0) {
    branchFilterSql = 'WHERE 1 = 0';
  } else if (selectedBranchId !== 'all') {
    branchFilterSql = 'WHERE (m.from_branch_id = ? OR m.to_branch_id = ? OR a.branch_id = ?)';
    params.push(selectedBranchId, selectedBranchId, selectedBranchId);
  } else {
    const placeholders = branches.map(() => '?').join(',');
    branchFilterSql = `WHERE (m.from_branch_id IN (${placeholders}) OR m.to_branch_id IN (${placeholders}) OR a.branch_id IN (${placeholders}))`;
    const ids = branches.map(b => b.id);
    params.push(...ids, ...ids, ...ids);
  }

  const movements = db.prepare(`
    SELECT
      m.*,
      a.asset_code,
      a.serial_number,
      dt.type_name,
      br.brand_name,
      dm.model_name,
      fb.branch_code AS from_branch_code,
      fb.branch_name AS from_branch_name,
      tb.branch_code AS to_branch_code,
      tb.branch_name AS to_branch_name
    FROM asset_movements m
    INNER JOIN assets a ON m.asset_id = a.id
    LEFT JOIN device_types dt ON a.device_type_id = dt.id
    LEFT JOIN brands br ON a.brand_id = br.id
    LEFT JOIN device_models dm ON a.model_id = dm.id
    LEFT JOIN branches fb ON m.from_branch_id = fb.id
    LEFT JOIN branches tb ON m.to_branch_id = tb.id
    ${branchFilterSql}
    ORDER BY m.id DESC
  `).all(...params);

  let assetWhere = '';
  const assetParams = [];
  if (selectedBranchId === 'none' || branches.length === 0) {
    assetWhere = 'WHERE 1 = 0';
  } else if (selectedBranchId !== 'all') {
    assetWhere = 'WHERE a.branch_id = ?';
    assetParams.push(selectedBranchId);
  } else {
    const placeholders = branches.map(() => '?').join(',');
    assetWhere = `WHERE a.branch_id IN (${placeholders})`;
    assetParams.push(...branches.map(b => b.id));
  }

  const accessibleAssets = db.prepare(`
    SELECT a.id, a.asset_code, a.serial_number, b.branch_code, dt.type_name, br.brand_name, dm.model_name
    FROM assets a
    LEFT JOIN branches b ON a.branch_id = b.id
    LEFT JOIN device_types dt ON a.device_type_id = dt.id
    LEFT JOIN brands br ON a.brand_id = br.id
    LEFT JOIN device_models dm ON a.model_id = dm.id
    ${assetWhere}
    ORDER BY a.asset_code ASC
  `).all(...assetParams);

  const allBranches = db.prepare(`SELECT id, branch_code, branch_name FROM branches ORDER BY branch_code ASC`).all();

  const stats = {
    total: movements.length,
    mutasiCabang: movements.filter(m => m.movement_type === 'MUTASI_CABANG').length,
    masukGudang: movements.filter(m => m.movement_type === 'MASUK_GUDANG').length,
    dismantleDisposal: movements.filter(m => ['DISMANTLE', 'DISPOSAL'].includes(m.movement_type)).length
  };

  res.render('assets/asset-movements', {
    title: 'Riwayat Mutasi Aset',
    activeMenu: 'asset-movements',
    movements,
    stats,
    branches,
    allBranches,
    accessibleAssets,
    successMsg: req.query.success || null,
    errorMsg: req.query.error || null
  });
};

// 10. GET /asset-maintenances - Menu Khusus Riwayat Service & Perbaikan Aset
exports.listMaintenances = (req, res) => {
  const selectedBranchId = req.selectedBranchId || 'all';
  const branches = req.accessibleBranches || [];

  let branchFilterSql = '';
  const params = [];

  if (selectedBranchId === 'none' || branches.length === 0) {
    branchFilterSql = 'WHERE 1 = 0';
  } else if (selectedBranchId !== 'all') {
    branchFilterSql = 'WHERE a.branch_id = ?';
    params.push(selectedBranchId);
  } else {
    const placeholders = branches.map(() => '?').join(',');
    branchFilterSql = `WHERE a.branch_id IN (${placeholders})`;
    params.push(...branches.map(b => b.id));
  }

  const maintenances = db.prepare(`
    SELECT
      m.*,
      a.asset_code,
      a.serial_number,
      a.status AS current_asset_status,
      b.branch_code,
      b.branch_name,
      dt.type_name,
      br.brand_name,
      dm.model_name
    FROM asset_maintenances m
    INNER JOIN assets a ON m.asset_id = a.id
    LEFT JOIN branches b ON a.branch_id = b.id
    LEFT JOIN device_types dt ON a.device_type_id = dt.id
    LEFT JOIN brands br ON a.brand_id = br.id
    LEFT JOIN device_models dm ON a.model_id = dm.id
    ${branchFilterSql}
    ORDER BY m.id DESC
  `).all(...params);

  const accessibleAssets = db.prepare(`
    SELECT a.id, a.asset_code, a.serial_number, b.branch_code, dt.type_name, br.brand_name, dm.model_name
    FROM assets a
    LEFT JOIN branches b ON a.branch_id = b.id
    LEFT JOIN device_types dt ON a.device_type_id = dt.id
    LEFT JOIN brands br ON a.brand_id = br.id
    LEFT JOIN device_models dm ON a.model_id = dm.id
    ${branchFilterSql}
    ORDER BY a.asset_code ASC
  `).all(...params);

  const stats = {
    total: maintenances.length,
    open: maintenances.filter(m => m.status === 'open').length,
    inProgress: maintenances.filter(m => m.status === 'in_progress').length,
    resolved: maintenances.filter(m => m.status === 'resolved').length,
    totalCost: maintenances.reduce((sum, m) => sum + (Number(m.cost) || 0), 0)
  };

  res.render('assets/asset-maintenances', {
    title: 'Service & Maintenance',
    activeMenu: 'asset-maintenances',
    maintenances,
    stats,
    branches,
    accessibleAssets,
    successMsg: req.query.success || null,
    errorMsg: req.query.error || null
  });
};

// Helper internal untuk mencari data lengkap aset berdasarkan asset_code atau serial_number
function findAssetForValidation(rawQuery) {
  const cleanCode = String(rawQuery || '').trim();
  if (!cleanCode) return null;

  const asset = db.prepare(`
    SELECT
      a.*,
      b.branch_code,
      b.branch_name,
      dt.type_name,
      br.brand_name,
      dm.model_name,
      d.id AS linked_device_id,
      d.hostname AS linked_hostname,
      d.ip_address AS linked_ip,
      d.room_location AS linked_location
    FROM assets a
    LEFT JOIN branches b ON a.branch_id = b.id
    LEFT JOIN device_types dt ON a.device_type_id = dt.id
    LEFT JOIN brands br ON a.brand_id = br.id
    LEFT JOIN device_models dm ON a.model_id = dm.id
    LEFT JOIN devices d ON d.asset_id = a.id
    WHERE UPPER(a.asset_code) = UPPER(?) OR UPPER(a.serial_number) = UPPER(?)
    LIMIT 1
  `).get(cleanCode, cleanCode);

  if (!asset) return null;

  const lastMovement = db.prepare(`
    SELECT
      m.*,
      tb.branch_code AS to_branch_code,
      tb.branch_name AS to_branch_name
    FROM asset_movements m
    LEFT JOIN branches tb ON m.to_branch_id = tb.id
    WHERE m.asset_id = ?
    ORDER BY m.id DESC
    LIMIT 1
  `).get(asset.id);

  return { asset, lastMovement };
}

// 11. GET /assets/validate - Halaman Scan & Validasi QR Stiker Aset
exports.validateAssetPage = (req, res) => {
  const queryCode = req.query.code ? String(req.query.code).trim() : '';
  const settings = getAssetSettings();

  let result = null;
  if (queryCode) {
    result = findAssetForValidation(queryCode);
  }

  res.render('assets/asset-validate', {
    title: 'Validasi QR Aset — SIMAJAR',
    queryCode,
    asset: result ? result.asset : null,
    lastMovement: result ? result.lastMovement : null,
    settings,
    isAuthenticated: Boolean(req.user)
  });
};

// 12. GET /api/assets/validate?code=... - Endpoint JSON untuk hasil scan kamera real-time
exports.apiValidateAsset = (req, res) => {
  const queryCode = req.query.code ? String(req.query.code).trim() : '';
  if (!queryCode) {
    return res.status(400).json({ valid: false, message: 'Kode aset atau Serial Number wajib diisi.' });
  }

  const result = findAssetForValidation(queryCode);
  if (!result) {
    return res.json({
      valid: false,
      queryCode,
      message: `Kode "${queryCode}" tidak terdaftar dalam database inventaris.`
    });
  }

  return res.json({
    valid: true,
    queryCode,
    asset: result.asset,
    lastMovement: result.lastMovement
  });
};