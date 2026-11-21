const db = require('../db');
const { logAudit } = require('../utils/auditLogger');

// =========================================================
// 1. MASTER BRAND / MERK (/brands)
// =========================================================
exports.indexBrands = (req, res) => {
  const errorMsg = req.query.error || null;
  const successMsg = req.query.success || null;

  const brands = db.prepare(`
    SELECT b.*,
      (SELECT COUNT(*) FROM device_models dm WHERE dm.brand_id = b.id) AS model_count,
      (SELECT COUNT(*) FROM devices d WHERE d.brand_id = b.id) AS device_count
    FROM brands b
    ORDER BY b.brand_name ASC
  `).all();

  res.render('brands', {
    title: 'Master Brand / Merk',
    activeMenu: 'brands',
    brands,
    errorMsg,
    successMsg
  });
};

exports.storeBrand = (req, res) => {
  const { brand_name } = req.body;
  if (!brand_name || !brand_name.trim()) {
    return res.redirect('/brands?error=' + encodeURIComponent('Nama brand wajib diisi.'));
  }

  try {
    const info = db.prepare('INSERT INTO brands (brand_name) VALUES (?)').run(brand_name.trim());
    logAudit(req, {
      action: 'CREATE',
      entityType: 'brand',
      entityId: info.lastInsertRowid,
      description: `Menambahkan master brand "${brand_name.trim()}".`
    });
    res.redirect('/brands?success=' + encodeURIComponent(`Brand "${brand_name.trim()}" berhasil ditambahkan.`));
  } catch (err) {
    res.redirect('/brands?error=' + encodeURIComponent('Brand sudah terdaftar atau gagal disimpan.'));
  }
};

exports.updateBrand = (req, res) => {
  const { id } = req.params;
  const { brand_name } = req.body;
  if (!brand_name || !brand_name.trim()) {
    return res.redirect('/brands?error=' + encodeURIComponent('Nama brand wajib diisi.'));
  }

  try {
    db.prepare('UPDATE brands SET brand_name = ? WHERE id = ?').run(brand_name.trim(), id);
    db.prepare('UPDATE devices SET brand = ? WHERE brand_id = ?').run(brand_name.trim(), id);

    logAudit(req, {
      action: 'UPDATE',
      entityType: 'brand',
      entityId: id,
      description: `Memperbarui nama brand menjadi "${brand_name.trim()}".`
    });
    res.redirect('/brands?success=' + encodeURIComponent(`Brand berhasil diperbarui menjadi "${brand_name.trim()}".`));
  } catch (err) {
    res.redirect('/brands?error=' + encodeURIComponent('Gagal memperbarui brand (nama sudah digunakan).'));
  }
};

exports.destroyBrand = (req, res) => {
  const { id } = req.params;
  const usedDevices = db.prepare('SELECT COUNT(*) AS total FROM devices WHERE brand_id = ?').get(id);
  if (usedDevices && usedDevices.total > 0) {
    return res.redirect('/brands?error=' + encodeURIComponent(`Brand tidak dapat dihapus karena masih digunakan oleh ${usedDevices.total} perangkat.`));
  }

  const target = db.prepare('SELECT brand_name FROM brands WHERE id = ?').get(id);
  db.prepare('DELETE FROM brands WHERE id = ?').run(id);
  if (target) {
    logAudit(req, {
      action: 'DELETE',
      entityType: 'brand',
      entityId: id,
      description: `Menghapus brand "${target.brand_name}".`
    });
  }
  res.redirect('/brands?success=' + encodeURIComponent('Brand berhasil dihapus.'));
};

// =========================================================
// 2. MASTER MODEL / TYPE (/device-models)
// =========================================================
exports.indexModels = (req, res) => {
  const errorMsg = req.query.error || null;
  const successMsg = req.query.success || null;

  const brands = db.prepare('SELECT id, brand_name FROM brands ORDER BY brand_name ASC').all();
  const deviceTypes = db.prepare('SELECT id, type_name FROM device_types ORDER BY type_name ASC').all();

  const models = db.prepare(`
    SELECT dm.*,
      b.brand_name,
      dt.type_name,
      (SELECT COUNT(*) FROM devices d WHERE d.model_id = dm.id) AS device_count
    FROM device_models dm
    JOIN brands b ON dm.brand_id = b.id
    LEFT JOIN device_types dt ON dm.device_type_id = dt.id
    ORDER BY b.brand_name ASC, dm.model_name ASC
  `).all();

  res.render('device-models', {
    title: 'Master Model / Type',
    activeMenu: 'device-models',
    brands,
    deviceTypes,
    models,
    errorMsg,
    successMsg
  });
};

exports.storeModel = (req, res) => {
  const { brand_id, device_type_id, model_name } = req.body;
  if (!brand_id || !model_name || !model_name.trim()) {
    return res.redirect('/device-models?error=' + encodeURIComponent('Brand dan nama model wajib diisi.'));
  }

  try {
    const typeIdVal = device_type_id ? parseInt(device_type_id, 10) : null;
    const info = db.prepare(`
      INSERT INTO device_models (brand_id, device_type_id, model_name)
      VALUES (?, ?, ?)
    `).run(brand_id, typeIdVal, model_name.trim());

    logAudit(req, {
      action: 'CREATE',
      entityType: 'device_model',
      entityId: info.lastInsertRowid,
      description: `Menambahkan model perangkat "${model_name.trim()}".`
    });
    res.redirect('/device-models?success=' + encodeURIComponent(`Model "${model_name.trim()}" berhasil ditambahkan.`));
  } catch (err) {
    res.redirect('/device-models?error=' + encodeURIComponent('Model tersebut sudah ada pada brand yang dipilih.'));
  }
};

exports.updateModel = (req, res) => {
  const { id } = req.params;
  const { brand_id, device_type_id, model_name } = req.body;
  if (!brand_id || !model_name || !model_name.trim()) {
    return res.redirect('/device-models?error=' + encodeURIComponent('Brand dan nama model wajib diisi.'));
  }

  try {
    const typeIdVal = device_type_id ? parseInt(device_type_id, 10) : null;
    db.prepare(`
      UPDATE device_models
      SET brand_id = ?, device_type_id = ?, model_name = ?
      WHERE id = ?
    `).run(brand_id, typeIdVal, model_name.trim(), id);

    const brandRow = db.prepare('SELECT brand_name FROM brands WHERE id = ?').get(brand_id);
    if (brandRow) {
      db.prepare('UPDATE devices SET brand_id = ?, brand = ?, model = ? WHERE model_id = ?')
        .run(brand_id, brandRow.brand_name, model_name.trim(), id);
    }

    logAudit(req, {
      action: 'UPDATE',
      entityType: 'device_model',
      entityId: id,
      description: `Memperbarui model perangkat menjadi "${model_name.trim()}".`
    });
    res.redirect('/device-models?success=' + encodeURIComponent(`Model berhasil diperbarui menjadi "${model_name.trim()}".`));
  } catch (err) {
    res.redirect('/device-models?error=' + encodeURIComponent('Gagal memperbarui model (duplikat pada brand tersebut).'));
  }
};

exports.destroyModel = (req, res) => {
  const { id } = req.params;
  const usedDevices = db.prepare('SELECT COUNT(*) AS total FROM devices WHERE model_id = ?').get(id);
  if (usedDevices && usedDevices.total > 0) {
    return res.redirect('/device-models?error=' + encodeURIComponent(`Model tidak dapat dihapus karena masih digunakan oleh ${usedDevices.total} perangkat.`));
  }

  const target = db.prepare('SELECT model_name FROM device_models WHERE id = ?').get(id);
  db.prepare('DELETE FROM device_models WHERE id = ?').run(id);
  if (target) {
    logAudit(req, {
      action: 'DELETE',
      entityType: 'device_model',
      entityId: id,
      description: `Menghapus model perangkat "${target.model_name}".`
    });
  }
  res.redirect('/device-models?success=' + encodeURIComponent('Model perangkat berhasil dihapus.'));
};