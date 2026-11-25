const db = require('../db');

// Helper: Generate Kode Audit Default (AUD/{BRANCH_CODE}/{YYMMDD}/{SEQ})
function generateNextAuditCode(branchCode) {
  const cleanBranch = String(branchCode || 'HO').trim().toUpperCase();
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const datePart = `${yy}${mm}${dd}`;

  const row = db.prepare(`
    SELECT audit_code FROM asset_audits
    WHERE audit_code LIKE ?
    ORDER BY id DESC LIMIT 1
  `).get(`AUD/${cleanBranch}/%`);

  let nextSeq = 1;
  if (row && row.audit_code) {
    const parts = row.audit_code.split('/');
    const lastSeq = parseInt(parts[parts.length - 1], 10);
    if (!Number.isNaN(lastSeq)) nextSeq = lastSeq + 1;
  }

  return `AUD/${cleanBranch}/${datePart}/${String(nextSeq).padStart(3, '0')}`;
}

// Helper: Cek apakah user boleh mengakses sesi audit tertentu
function canAccessAuditSession(user, auditId) {
  if (!user) return false;
  if (user.role === 'administrator') return true;
  const assigned = db.prepare(`
    SELECT 1 FROM asset_audit_assignees
    WHERE audit_id = ? AND user_id = ?
  `).get(auditId, user.id);
  return Boolean(assigned);
}

// Helper: Ambil pengaturan organisasi
function getOrgSettings() {
  const rows = db.prepare('SELECT setting_key, setting_value FROM app_settings').all();
  const map = {};
  rows.forEach(r => { map[r.setting_key] = r.setting_value; });
  return map;
}

// Helper: Ambil daftar item kertas kerja + statistik ringkasan audit
function getAuditItemsAndStats(auditId) {
  const items = db.prepare(`
    SELECT
      i.*,
      a.asset_code,
      a.serial_number,
      a.mac_address,
      a.physical_photo,
      a.sn_photo,
      dt.type_name,
      br.brand_name,
      dm.model_name,
      eb.branch_code AS expected_branch_code,
      eb.branch_name AS expected_branch_name,
      fb.branch_code AS found_branch_code,
      fb.branch_name AS found_branch_name,
      su.full_name AS scanner_name,
      d.hostname AS linked_hostname,
      d.room_location AS linked_location
    FROM asset_audit_items i
    LEFT JOIN assets a ON i.asset_id = a.id
    LEFT JOIN device_types dt ON a.device_type_id = dt.id
    LEFT JOIN brands br ON a.brand_id = br.id
    LEFT JOIN device_models dm ON a.model_id = dm.id
    LEFT JOIN branches eb ON i.expected_branch_id = eb.id
    LEFT JOIN branches fb ON i.found_branch_id = fb.id
    LEFT JOIN users su ON i.scanned_by = su.id
    LEFT JOIN devices d ON d.asset_id = a.id
    WHERE i.audit_id = ?
    ORDER BY
      CASE i.finding_type
        WHEN 'pending' THEN 1
        WHEN 'condition_mismatch' THEN 2
        WHEN 'misplaced' THEN 3
        WHEN 'unregistered' THEN 4
        WHEN 'missing' THEN 5
        WHEN 'matched' THEN 6
        ELSE 7
      END,
      i.scanned_at DESC,
      i.id ASC
  `).all(auditId);

  const stats = {
    totalTarget: 0,
    pending: 0,
    matched: 0,
    condition_mismatch: 0,
    misplaced: 0,
    missing: 0,
    unregistered: 0,
    accuracyPercent: 0
  };

  items.forEach(it => {
    if (it.finding_type !== 'unregistered' && it.finding_type !== 'misplaced') {
      stats.totalTarget += 1;
    }
    if (Object.prototype.hasOwnProperty.call(stats, it.finding_type)) {
      stats[it.finding_type] += 1;
    }
  });

  if (stats.totalTarget > 0) {
    stats.accuracyPercent = Math.round((stats.matched / stats.totalTarget) * 100);
  }

  return { items, stats };
}

// 1. GET /assets/audits - Daftar Sesi Audit
exports.listAudits = (req, res) => {
  const isAdmin = req.user.role === 'administrator';

  let audits = [];
  if (isAdmin) {
    audits = db.prepare(`
      SELECT
        au.*,
        b.branch_code,
        b.branch_name,
        u.full_name AS creator_name,
        (SELECT COUNT(*) FROM asset_audit_items i WHERE i.audit_id = au.id AND i.finding_type != 'unregistered' AND i.finding_type != 'misplaced') AS total_target,
        (SELECT COUNT(*) FROM asset_audit_items i WHERE i.audit_id = au.id AND i.finding_type != 'pending' AND i.finding_type != 'missing') AS total_checked
      FROM asset_audits au
      LEFT JOIN branches b ON au.branch_id = b.id
      LEFT JOIN users u ON au.created_by = u.id
      ORDER BY au.id DESC
    `).all();
  } else {
    audits = db.prepare(`
      SELECT
        au.*,
        b.branch_code,
        b.branch_name,
        u.full_name AS creator_name,
        (SELECT COUNT(*) FROM asset_audit_items i WHERE i.audit_id = au.id AND i.finding_type != 'unregistered' AND i.finding_type != 'misplaced') AS total_target,
        (SELECT COUNT(*) FROM asset_audit_items i WHERE i.audit_id = au.id AND i.finding_type != 'pending' AND i.finding_type != 'missing') AS total_checked
      FROM asset_audits au
      JOIN asset_audit_assignees aa ON aa.audit_id = au.id AND aa.user_id = ?
      LEFT JOIN branches b ON au.branch_id = b.id
      LEFT JOIN users u ON au.created_by = u.id
      ORDER BY au.id DESC
    `).all(req.user.id);
  }

  const assigneesStmt = db.prepare(`
    SELECT u.id, u.full_name, u.username, u.role
    FROM asset_audit_assignees aa
    JOIN users u ON aa.user_id = u.id
    WHERE aa.audit_id = ?
  `);
  audits.forEach(au => {
    au.assignees = assigneesStmt.all(au.id);
  });

  const branches = isAdmin
    ? db.prepare('SELECT id, branch_code, branch_name FROM branches ORDER BY branch_code ASC').all()
    : [];

  const suggestedCodes = {};
  branches.forEach(b => {
    suggestedCodes[b.id] = generateNextAuditCode(b.branch_code);
  });

  let users = [];
  if (isAdmin) {
    users = db.prepare(`
      SELECT id, full_name, username, role, all_branches
      FROM users
      WHERE is_active = 1
      ORDER BY full_name ASC
    `).all();

    const userBranchStmt = db.prepare('SELECT branch_id FROM user_branches WHERE user_id = ?');
    users.forEach(u => {
      u.branch_ids = userBranchStmt.all(u.id).map(r => Number(r.branch_id));
    });
  }

  res.render('assets/audits', {
    title: 'Audit Aset (Stock Opname) — SIMAJAR',
    pageTitle: 'Audit Aset & Stock Opname',
    activeMenu: 'asset-audits',
    audits,
    branches,
    suggestedCodes,
    users,
    isAdmin,
    msg: req.query.msg || '',
    err: req.query.err || ''
  });
};

// 2. POST /assets/audits - Buat Sesi Audit Baru (Khusus Administrator)
exports.createAudit = (req, res) => {
  const { title, branch_id, audit_code, notes, assignee_ids } = req.body;
  const branchId = Number(branch_id);

  if (!title || !branchId) {
    return res.redirect('/assets/audits?err=' + encodeURIComponent('Judul audit dan cabang target wajib diisi.'));
  }

  const branch = db.prepare('SELECT id, branch_code, branch_name FROM branches WHERE id = ?').get(branchId);
  if (!branch) {
    return res.redirect('/assets/audits?err=' + encodeURIComponent('Cabang tidak ditemukan.'));
  }

  const normalizedAssignees = Array.isArray(assignee_ids)
    ? assignee_ids.map(Number).filter(Boolean)
    : (assignee_ids ? [Number(assignee_ids)].filter(Boolean) : []);

  if (normalizedAssignees.length === 0) {
    return res.redirect('/assets/audits?err=' + encodeURIComponent('Pilih minimal 1 user auditor yang ditugaskan.'));
  }

  const customCode = audit_code ? String(audit_code).trim().toUpperCase() : '';
  const finalAuditCode = customCode || generateNextAuditCode(branch.branch_code);

  const duplicate = db.prepare('SELECT id FROM asset_audits WHERE UPPER(audit_code) = UPPER(?)').get(finalAuditCode);
  if (duplicate) {
    return res.redirect('/assets/audits?err=' + encodeURIComponent(`Kode audit "${finalAuditCode}" sudah terdaftar. Silakan gunakan kode lain.`));
  }

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO asset_audits (audit_code, title, branch_id, status, notes, created_by)
      VALUES (?, ?, ?, 'in_progress', ?, ?)
    `).run(finalAuditCode, title.trim(), branchId, notes ? notes.trim() : null, req.user.id);

    const auditId = info.lastInsertRowid;

    const insertAssignee = db.prepare(`
      INSERT OR IGNORE INTO asset_audit_assignees (audit_id, user_id) VALUES (?, ?)
    `);
    normalizedAssignees.forEach(uid => insertAssignee.run(auditId, uid));

    const targetAssets = db.prepare(`
      SELECT id, branch_id, status, condition
      FROM assets
      WHERE branch_id = ? AND LOWER(COALESCE(status, 'active')) != 'disposed'
    `).all(branchId);

    const insertItem = db.prepare(`
      INSERT INTO asset_audit_items (
        audit_id, asset_id, expected_branch_id, expected_status, expected_condition, finding_type
      ) VALUES (?, ?, ?, ?, ?, 'pending')
    `);

    targetAssets.forEach(asset => {
      insertItem.run(auditId, asset.id, asset.branch_id, asset.status, asset.condition);
    });

    try {
      db.prepare(`
        INSERT INTO audit_logs (user_id, action, target_type, target_id, details)
        VALUES (?, 'CREATE_ASSET_AUDIT', 'asset_audit', ?, ?)
      `).run(req.user.id, auditId, `Membuat sesi audit ${finalAuditCode} untuk cabang ${branch.branch_code} (${targetAssets.length} target aset)`);
    } catch (e) {}

    return auditId;
  });

  const newAuditId = tx();
  return res.redirect(`/assets/audits/${newAuditId}?msg=` + encodeURIComponent('Sesi audit berhasil dibuat dan siap dipindai.'));
};

// 3. POST /assets/audits/:id/assignees - Update Penugasan Auditor (Khusus Administrator)
exports.updateAssignees = (req, res) => {
  const auditId = Number(req.params.id);
  const { assignee_ids } = req.body;

  const normalized = Array.isArray(assignee_ids)
    ? assignee_ids.map(Number).filter(Boolean)
    : (assignee_ids ? [Number(assignee_ids)].filter(Boolean) : []);

  if (normalized.length === 0) {
    return res.redirect(`/assets/audits/${auditId}?err=` + encodeURIComponent('Minimal 1 auditor harus ditugaskan.'));
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM asset_audit_assignees WHERE audit_id = ?').run(auditId);
    const ins = db.prepare('INSERT OR IGNORE INTO asset_audit_assignees (audit_id, user_id) VALUES (?, ?)');
    normalized.forEach(uid => ins.run(auditId, uid));
  });
  tx();

  return res.redirect(`/assets/audits/${auditId}?msg=` + encodeURIComponent('Daftar auditor berhasil diperbarui.'));
};

// 4. GET /assets/audits/:id - Detail Sesi Audit (Eksekusi Scan + Laporan)
exports.detailAudit = (req, res) => {
  const auditId = Number(req.params.id);
  if (!canAccessAuditSession(req.user, auditId)) {
    return res.status(403).render('forbidden', {
      title: '403 Akses Ditolak',
      activeMenu: '',
      message: 'Anda tidak ditugaskan pada sesi audit ini.'
    });
  }

  const audit = db.prepare(`
    SELECT
      au.*,
      b.branch_code,
      b.branch_name,
      u.full_name AS creator_name
    FROM asset_audits au
    LEFT JOIN branches b ON au.branch_id = b.id
    LEFT JOIN users u ON au.created_by = u.id
    WHERE au.id = ?
  `).get(auditId);

  if (!audit) {
    return res.status(404).send('Sesi audit tidak ditemukan.');
  }

  const assignees = db.prepare(`
    SELECT u.id, u.full_name, u.username, u.role
    FROM asset_audit_assignees aa
    JOIN users u ON aa.user_id = u.id
    WHERE aa.audit_id = ?
    ORDER BY u.full_name ASC
  `).all(auditId);

  const { items, stats } = getAuditItemsAndStats(auditId);

  const isAdmin = req.user.role === 'administrator';

  const allUsers = isAdmin
    ? db.prepare('SELECT id, full_name, username, role FROM users WHERE is_active = 1 ORDER BY full_name ASC').all()
    : [];

  const deviceTypes = isAdmin
    ? db.prepare('SELECT id, type_name FROM device_types ORDER BY type_name ASC').all()
    : [];

  const brands = isAdmin
    ? db.prepare('SELECT id, brand_name FROM brands ORDER BY brand_name ASC').all()
    : [];

  const deviceModels = isAdmin
    ? db.prepare('SELECT id, brand_id, device_type_id, model_name FROM device_models ORDER BY model_name ASC').all()
    : [];

  const settings = getOrgSettings();

  res.render('assets/audit-detail', {
    title: `${audit.audit_code} — Audit Aset SIMAJAR`,
    pageTitle: `Audit: ${audit.audit_code}`,
    activeMenu: 'asset-audits',
    audit,
    assignees,
    items,
    stats,
    allUsers,
    deviceTypes,
    brands,
    deviceModels,
    settings,
    isAdmin,
    msg: req.query.msg || '',
    err: req.query.err || ''
  });
};

// 5. POST /api/assets/audits/:id/scan - Eksekusi Scan QR / Input Kode di Lapangan (AJAX Tanpa Reload Halaman)
exports.scanAuditAsset = (req, res) => {
  const auditId = Number(req.params.id);
  if (!canAccessAuditSession(req.user, auditId)) {
    return res.status(403).json({ success: false, message: 'Anda tidak ditugaskan pada sesi audit ini.' });
  }

  const audit = db.prepare('SELECT * FROM asset_audits WHERE id = ?').get(auditId);
  if (!audit) {
    return res.status(404).json({ success: false, message: 'Sesi audit tidak ditemukan.' });
  }
  if (audit.status !== 'in_progress') {
    return res.status(400).json({ success: false, message: 'Sesi audit sudah ditutup (Closed).' });
  }

  const rawCode = String(req.body.code || '').trim();
  const actualCondition = String(req.body.actual_condition || 'baik').trim().toLowerCase();
  const notes = req.body.notes ? String(req.body.notes).trim() : null;

  if (!rawCode) {
    return res.status(400).json({ success: false, message: 'Kode inventaris atau Serial Number wajib diisi.' });
  }

  const asset = db.prepare(`
    SELECT
      a.*,
      b.branch_code,
      b.branch_name,
      dt.type_name,
      br.brand_name,
      dm.model_name
    FROM assets a
    LEFT JOIN branches b ON a.branch_id = b.id
    LEFT JOIN device_types dt ON a.device_type_id = dt.id
    LEFT JOIN brands br ON a.brand_id = br.id
    LEFT JOIN device_models dm ON a.model_id = dm.id
    WHERE UPPER(a.asset_code) = UPPER(?) OR UPPER(a.serial_number) = UPPER(?)
    LIMIT 1
  `).get(rawCode, rawCode);

  if (!asset) {
    return res.json({
      success: false,
      notFoundInMaster: true,
      scannedCode: rawCode,
      message: `Kode "${rawCode}" tidak terdaftar di Master Aset. Gunakan form "Catat Barang Belum Terdaftar" jika fisik perangkat ada di lokasi.`
    });
  }

  const isWrongBranch = Number(asset.branch_id) !== Number(audit.branch_id);
  const expectedCond = String(asset.condition || 'baik').toLowerCase();
  const isConditionChanged = actualCondition !== expectedCond && actualCondition !== 'baik';

  let findingType = 'matched';
  if (isWrongBranch) {
    findingType = 'misplaced';
  } else if (isConditionChanged || ['rusak_ringan', 'rusak_berat', 'broken'].includes(actualCondition)) {
    findingType = 'condition_mismatch';
  }

  const existingItem = db.prepare(`
    SELECT id FROM asset_audit_items WHERE audit_id = ? AND asset_id = ?
  `).get(auditId, asset.id);

  if (existingItem) {
    db.prepare(`
      UPDATE asset_audit_items
      SET found_branch_id = ?,
          actual_condition = ?,
          finding_type = ?,
          notes = COALESCE(?, notes),
          scanned_by = ?,
          scanned_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(audit.branch_id, actualCondition, findingType, notes, req.user.id, existingItem.id);
  } else {
    db.prepare(`
      INSERT INTO asset_audit_items (
        audit_id, asset_id, expected_branch_id, found_branch_id,
        expected_status, expected_condition, actual_condition,
        finding_type, notes, scanned_by, scanned_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `).run(
      auditId, asset.id, asset.branch_id, audit.branch_id,
      asset.status, asset.condition, actualCondition,
      findingType, notes, req.user.id
    );
  }

  const updated = getAuditItemsAndStats(auditId);

  return res.json({
    success: true,
    findingType,
    asset,
    items: updated.items,
    stats: updated.stats,
    message: findingType === 'misplaced'
      ? `Aset ditemukan, namun terdaftar milik cabang ${asset.branch_code} (${asset.branch_name}).`
      : (findingType === 'condition_mismatch'
        ? `Aset tercatat dengan perubahan kondisi (${actualCondition}).`
        : `Aset ${asset.asset_code} terverifikasi sesuai.`)
  });
};

// 6. POST /assets/audits/:id/unregistered - Catat Barang Ada di Lapangan Tapi Belum Terdaftar
exports.addUnregisteredFinding = (req, res) => {
  const auditId = Number(req.params.id);
  if (!canAccessAuditSession(req.user, auditId)) {
    return res.status(403).render('forbidden', {
      title: '403 Akses Ditolak',
      activeMenu: '',
      message: 'Anda tidak ditugaskan pada sesi audit ini.'
    });
  }

  const audit = db.prepare('SELECT * FROM asset_audits WHERE id = ?').get(auditId);
  if (!audit || audit.status !== 'in_progress') {
    return res.redirect(`/assets/audits/${auditId}?err=` + encodeURIComponent('Sesi audit tidak aktif atau sudah ditutup.'));
  }

  const {
    unregistered_name,
    unregistered_type,
    unregistered_brand_model,
    unregistered_sn,
    unregistered_location,
    actual_condition,
    notes
  } = req.body;

  if (!unregistered_name || !String(unregistered_name).trim()) {
    return res.redirect(`/assets/audits/${auditId}?err=` + encodeURIComponent('Nama / deskripsi perangkat wajib diisi.'));
  }

  const photoPath = req.file ? `/uploads/${req.file.filename}` : null;

  db.prepare(`
    INSERT INTO asset_audit_items (
      audit_id, asset_id, found_branch_id, actual_condition, finding_type,
      unregistered_name, unregistered_type, unregistered_brand_model,
      unregistered_sn, unregistered_location, photo_evidence, notes,
      scanned_by, scanned_at
    ) VALUES (?, NULL, ?, ?, 'unregistered', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
  `).run(
    auditId,
    audit.branch_id,
    actual_condition || 'baik',
    String(unregistered_name).trim(),
    unregistered_type ? String(unregistered_type).trim() : null,
    unregistered_brand_model ? String(unregistered_brand_model).trim() : null,
    unregistered_sn ? String(unregistered_sn).trim() : null,
    unregistered_location ? String(unregistered_location).trim() : null,
    photoPath,
    notes ? String(notes).trim() : null,
    req.user.id
  );

  return res.redirect(`/assets/audits/${auditId}?msg=` + encodeURIComponent('Temuan barang belum terdaftar berhasil dicatat.'));
};

// 7. POST /assets/audits/:id/close - Selesaikan Audit (Khusus Administrator)
exports.closeAudit = (req, res) => {
  const auditId = Number(req.params.id);
  const audit = db.prepare('SELECT * FROM asset_audits WHERE id = ?').get(auditId);
  if (!audit) {
    return res.redirect('/assets/audits?err=' + encodeURIComponent('Sesi audit tidak ditemukan.'));
  }

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE asset_audit_items
      SET finding_type = 'missing'
      WHERE audit_id = ? AND finding_type = 'pending'
    `).run(auditId);

    db.prepare(`
      UPDATE asset_audits
      SET status = 'closed', completed_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(auditId);
  });
  tx();

  return res.redirect(`/assets/audits/${auditId}?msg=` + encodeURIComponent('Sesi audit telah diselesaikan dan dikunci.'));
};

// 8. POST /assets/audits/:id/reconcile - Sinkronkan Temuan ke Master Aset (Khusus Administrator)
exports.reconcileAudit = (req, res) => {
  const auditId = Number(req.params.id);
  const audit = db.prepare('SELECT * FROM asset_audits WHERE id = ?').get(auditId);
  if (!audit || audit.status !== 'closed') {
    return res.redirect(`/assets/audits/${auditId}?err=` + encodeURIComponent('Sesi audit harus berstatus Closed sebelum direkonsiliasi.'));
  }
  if (audit.is_reconciled === 1) {
    return res.redirect(`/assets/audits/${auditId}?err=` + encodeURIComponent('Sesi audit ini sudah pernah direkonsiliasi.'));
  }

  const tx = db.transaction(() => {
    const items = db.prepare(`
      SELECT * FROM asset_audit_items WHERE audit_id = ? AND asset_id IS NOT NULL
    `).all(auditId);

    items.forEach(it => {
      if (it.finding_type === 'misplaced' && it.found_branch_id) {
        db.prepare('UPDATE assets SET branch_id = ? WHERE id = ?').run(it.found_branch_id, it.asset_id);
        try {
          db.prepare(`
            INSERT INTO asset_movements (asset_id, from_branch_id, to_branch_id, movement_type, notes, moved_by)
            VALUES (?, ?, ?, 'transfer', ?, ?)
          `).run(
            it.asset_id,
            it.expected_branch_id,
            it.found_branch_id,
            `Rekonsiliasi otomatis dari hasil Audit ${audit.audit_code}`,
            req.user.id
          );
        } catch (e) {}
      }

      if (it.finding_type === 'condition_mismatch' && it.actual_condition) {
        const isBroken = ['rusak_berat', 'broken'].includes(it.actual_condition);
        if (isBroken) {
          db.prepare(`UPDATE assets SET condition = ?, status = 'broken' WHERE id = ?`).run(it.actual_condition, it.asset_id);
        } else {
          db.prepare(`UPDATE assets SET condition = ? WHERE id = ?`).run(it.actual_condition, it.asset_id);
        }
      }
    });

    db.prepare('UPDATE asset_audits SET is_reconciled = 1 WHERE id = ?').run(auditId);
  });
  tx();

  return res.redirect(`/assets/audits/${auditId}?msg=` + encodeURIComponent('Hasil temuan audit berhasil disinkronkan ke Master Aset.'));
};

// 9. GET /assets/audits/:id/export - Export Laporan Audit ke CSV (Excel)
exports.exportAuditCsv = (req, res) => {
  const auditId = Number(req.params.id);
  if (!canAccessAuditSession(req.user, auditId)) {
    return res.status(403).send('Akses ditolak.');
  }

  const audit = db.prepare(`
    SELECT au.*, b.branch_code, b.branch_name
    FROM asset_audits au
    LEFT JOIN branches b ON au.branch_id = b.id
    WHERE au.id = ?
  `).get(auditId);
  if (!audit) return res.status(404).send('Audit tidak ditemukan.');

  const rows = db.prepare(`
    SELECT
      i.*,
      a.asset_code,
      a.serial_number,
      dt.type_name,
      br.brand_name,
      dm.model_name,
      eb.branch_code AS expected_branch_code,
      fb.branch_code AS found_branch_code,
      su.full_name AS scanner_name
    FROM asset_audit_items i
    LEFT JOIN assets a ON i.asset_id = a.id
    LEFT JOIN device_types dt ON a.device_type_id = dt.id
    LEFT JOIN brands br ON a.brand_id = br.id
    LEFT JOIN device_models dm ON a.model_id = dm.id
    LEFT JOIN branches eb ON i.expected_branch_id = eb.id
    LEFT JOIN branches fb ON i.found_branch_id = fb.id
    LEFT JOIN users su ON i.scanned_by = su.id
    WHERE i.audit_id = ?
    ORDER BY i.id ASC
  `).all(auditId);

  const escCsv = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;
  const header = [
    'Kode Audit', 'Cabang Audit', 'Kode Inventaris', 'Nama/Model Perangkat',
    'Jenis', 'Serial Number', 'Hasil Temuan', 'Cabang Sistem',
    'Cabang Ditemukan', 'Kondisi Sistem', 'Kondisi Aktual', 'Petugas Scan', 'Waktu Scan', 'Catatan'
  ].map(escCsv).join(',');

  const lines = rows.map(r => {
    const isUnreg = r.finding_type === 'unregistered';
    const nameOrModel = isUnreg
      ? `${r.unregistered_name || ''} ${r.unregistered_brand_model ? '(' + r.unregistered_brand_model + ')' : ''}`.trim()
      : `${r.brand_name || ''} ${r.model_name || ''}`.trim();

    return [
      audit.audit_code,
      `${audit.branch_code} - ${audit.branch_name}`,
      isUnreg ? 'BELUM TERDAFTAR' : (r.asset_code || '-'),
      nameOrModel || '-',
      isUnreg ? (r.unregistered_type || '-') : (r.type_name || '-'),
      isUnreg ? (r.unregistered_sn || '-') : (r.serial_number || '-'),
      String(r.finding_type || '').toUpperCase(),
      r.expected_branch_code || '-',
      r.found_branch_code || '-',
      r.expected_condition || '-',
      r.actual_condition || '-',
      r.scanner_name || '-',
      r.scanned_at || '-',
      r.notes || ''
    ].map(escCsv).join(',');
  });

  const csvContent = '\uFEFF' + [header, ...lines].join('\n');
  const safeFilename = audit.audit_code.replace(/[^a-zA-Z0-9_-]/g, '_');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="Laporan_${safeFilename}.csv"`);
  return res.send(csvContent);
};

// 10. POST /assets/audits/:id/items/:itemId/register - Daftarkan Temuan Unregistered ke Master Aset
exports.registerUnregisteredItem = (req, res) => {
  const auditId = Number(req.params.id);
  const itemId = Number(req.params.itemId);

  const audit = db.prepare(`
    SELECT au.*, b.branch_code
    FROM asset_audits au
    LEFT JOIN branches b ON au.branch_id = b.id
    WHERE au.id = ?
  `).get(auditId);

  if (!audit) {
    return res.redirect('/assets/audits?err=' + encodeURIComponent('Sesi audit tidak ditemukan.'));
  }

  const item = db.prepare(`
    SELECT * FROM asset_audit_items
    WHERE id = ? AND audit_id = ? AND finding_type = 'unregistered'
  `).get(itemId, auditId);

  if (!item) {
    return res.redirect(`/assets/audits/${auditId}?err=` + encodeURIComponent('Item temuan tidak ditemukan atau sudah terdaftar.'));
  }

  const {
    asset_code,
    device_type_id,
    brand_id,
    model_id,
    serial_number,
    mac_address,
    condition,
    notes
  } = req.body;

  // Generate kode inventaris default INV/{BRANCH_CODE}/{000001} jika dikosongkan
  let finalAssetCode = asset_code ? String(asset_code).trim().toUpperCase() : '';
  if (!finalAssetCode) {
    const bCode = String(audit.branch_code || 'HO').trim().toUpperCase();
    const lastRow = db.prepare(`
      SELECT asset_code FROM assets
      WHERE asset_code LIKE ?
      ORDER BY id DESC LIMIT 1
    `).get(`INV/${bCode}/%`);

    let nextNum = 1;
    if (lastRow && lastRow.asset_code) {
      const parts = lastRow.asset_code.split('/');
      const parsed = parseInt(parts[parts.length - 1], 10);
      if (!Number.isNaN(parsed)) nextNum = parsed + 1;
    }
    finalAssetCode = `INV/${bCode}/${String(nextNum).padStart(6, '0')}`;
  }

  const dupCode = db.prepare('SELECT id FROM assets WHERE UPPER(asset_code) = UPPER(?)').get(finalAssetCode);
  if (dupCode) {
    return res.redirect(`/assets/audits/${auditId}?err=` + encodeURIComponent(`Kode inventaris "${finalAssetCode}" sudah digunakan aset lain.`));
  }

  const actualCond = String(condition || item.actual_condition || 'baik').trim().toLowerCase();
  const assetStatus = ['rusak_berat', 'broken'].includes(actualCond) ? 'broken' : 'active';
  const newFindingType = ['rusak_ringan', 'rusak_berat', 'broken'].includes(actualCond)
    ? 'condition_mismatch'
    : 'matched';

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO assets (
        asset_code, branch_id, device_type_id, brand_id, model_id,
        serial_number, mac_address, status, condition, physical_photo, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      finalAssetCode,
      audit.branch_id,
      device_type_id ? Number(device_type_id) : null,
      brand_id ? Number(brand_id) : null,
      model_id ? Number(model_id) : null,
      serial_number ? String(serial_number).trim() : (item.unregistered_sn || null),
      mac_address ? String(mac_address).trim() : null,
      assetStatus,
      actualCond,
      item.photo_evidence || null,
      notes ? String(notes).trim() : (item.notes || null),
      req.user.id
    );

    const newAssetId = info.lastInsertRowid;

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
      audit.branch_id,
      assetStatus,
      actualCond,
      actualCond,
      newFindingType,
      notes ? String(notes).trim() : item.notes,
      item.id
    );

    try {
      db.prepare(`
        INSERT INTO audit_logs (user_id, action, target_type, target_id, details)
        VALUES (?, 'REGISTER_UNREGISTERED_ASSET', 'asset', ?, ?)
      `).run(req.user.id, newAssetId, `Mendaftarkan temuan audit ${audit.audit_code} menjadi aset ${finalAssetCode}`);
    } catch (e) {}
  });

  tx();
  return res.redirect(`/assets/audits/${auditId}?msg=` + encodeURIComponent(`Perangkat berhasil didaftarkan ke Master Aset dengan kode ${finalAssetCode}.`));
};