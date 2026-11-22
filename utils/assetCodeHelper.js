const db = require('../db');

function getAssetSettings() {
  const rows = db.prepare(`SELECT setting_key, setting_value FROM app_settings`).all();
  const settings = {
    asset_code_format: 'INV/{BRANCH}/{YYMMDD}/{SEQ:6}',
    organization_name: 'IT Infrastructure'
  };
  rows.forEach(r => {
    settings[r.setting_key] = r.setting_value;
  });
  return settings;
}

function generateNextAssetCode(branchId, dateInput = null) {
  const settings = getAssetSettings();
  const pattern = settings.asset_code_format || 'INV/{BRANCH}/{YYMMDD}/{SEQ:6}';

  const branch = db.prepare(`SELECT branch_code FROM branches WHERE id = ?`).get(branchId);
  const branchCode = branch ? branch.branch_code.toUpperCase() : 'HO';

  const d = dateInput ? new Date(dateInput) : new Date();
  const validDate = isNaN(d.getTime()) ? new Date() : d;
  const yyyy = String(validDate.getFullYear());
  const yy = yyyy.slice(-2);
  const mm = String(validDate.getMonth() + 1).padStart(2, '0');
  const dd = String(validDate.getDate()).padStart(2, '0');
  const yymmdd = `${yy}${mm}${dd}`;

  // Ambil ID terakhir dari tabel assets sebagai basis nomor urut agar tidak pernah bentrok
  const lastRow = db.prepare(`SELECT COALESCE(MAX(id), 0) as max_id FROM assets`).get();
  let nextSeq = (lastRow ? lastRow.max_id : 0) + 1;

  const buildCode = (seqNum) => {
    let result = pattern
      .replace(/\{BRANCH\}/gi, branchCode)
      .replace(/\{YYYY\}/gi, yyyy)
      .replace(/\{YYMMDD\}/gi, yymmdd)
      .replace(/\{YY\}/gi, yy)
      .replace(/\{MM\}/gi, mm)
      .replace(/\{DD\}/gi, dd);

    // Tangani variabel {SEQ:N} atau {SEQ}
    result = result.replace(/\{SEQ(?::(\d+))?\}/gi, (_, digits) => {
      const padLen = digits ? parseInt(digits, 10) : 6;
      return String(seqNum).padStart(padLen, '0');
    });

    return result;
  };

  let candidate = buildCode(nextSeq);
  while (db.prepare(`SELECT id FROM assets WHERE asset_code = ?`).get(candidate)) {
    nextSeq += 1;
    candidate = buildCode(nextSeq);
  }

  return candidate;
}

module.exports = {
  getAssetSettings,
  generateNextAssetCode
};