const db = require('../db');

function getAssetSettings() {
  const rows = db.prepare(`SELECT setting_key, setting_value FROM app_settings`).all();
  const settings = {
    asset_code_format: 'INV/{BRANCH}/{YYMMDD}/{SEQ:6}',
    organization_name: 'IT Network Engineer'
  };
  rows.forEach(r => {
    settings[r.setting_key] = r.setting_value;
  });
  return settings;
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  const hasBranchToken = /\{BRANCH\}/i.test(pattern);

  let templateForMatch = pattern;
  if (hasBranchToken) {
    templateForMatch = templateForMatch.replace(/\{BRANCH\}/gi, branchCode);
  } else {
    templateForMatch = templateForMatch.replace(/\{BRANCH\}/gi, '[A-Z0-9_-]+');
  }

  templateForMatch = templateForMatch
    .replace(/\{YYMMDD\}/gi, '\\d{6}')
    .replace(/\{YYYY\}/gi, '\\d{4}')
    .replace(/\{YY\}/gi, '\\d{2}')
    .replace(/\{MM\}/gi, '\\d{2}')
    .replace(/\{DD\}/gi, '\\d{2}');

  const SEQ_PLACEHOLDER = '___SEQ_CAPTURE___';
  const YYMMDD_PLACEHOLDER = '___YYMMDD_RE___';
  const YYYY_PLACEHOLDER = '___YYYY_RE___';
  const YY_PLACEHOLDER = '___YY_RE___';
  const MM_PLACEHOLDER = '___MM_RE___';
  const DD_PLACEHOLDER = '___DD_RE___';
  const BRANCH_ANY_PLACEHOLDER = '___BRANCH_RE___';

  let preEscaped = templateForMatch
    .replace(/\{SEQ(?::\d+)?\}/gi, SEQ_PLACEHOLDER)
    .replace(/\\d\{6\}/g, YYMMDD_PLACEHOLDER)
    .replace(/\\d\{4\}/g, YYYY_PLACEHOLDER)
    .replace(/\\d\{2\}/g, (m, offset, str) => {
      // bedakan MM/DD/YY (semua \\d{2})
      return str.slice(offset - 2, offset) === 'MM'
        ? MM_PLACEHOLDER
        : str.slice(offset - 2, offset) === 'DD'
          ? DD_PLACEHOLDER
          : YY_PLACEHOLDER;
    });

  let regexSource = '^';
  const tokenRegex = /\{(BRANCH|YYYY|YYMMDD|YY|MM|DD|SEQ(?::\d+)?)\}/gi;
  let lastIndex = 0;
  let m;

  while ((m = tokenRegex.exec(pattern)) !== null) {
    regexSource += escapeRegExp(pattern.slice(lastIndex, m.index));
    const token = m[1].toUpperCase();

    if (token === 'BRANCH') {
      regexSource += escapeRegExp(branchCode);
    } else if (token === 'YYYY') {
      regexSource += '\\d{4}';
    } else if (token === 'YYMMDD') {
      regexSource += '\\d{6}';
    } else if (token === 'YY' || token === 'MM' || token === 'DD') {
      regexSource += '\\d{2}';
    } else if (token.startsWith('SEQ')) {
      regexSource += '(\\d+)';
    }

    lastIndex = tokenRegex.lastIndex;
  }
  regexSource += escapeRegExp(pattern.slice(lastIndex)) + '$';

  const seqRegex = new RegExp(regexSource, 'i');

  const existingRows = hasBranchToken && branchId
    ? db.prepare(`SELECT asset_code FROM assets WHERE branch_id = ?`).all(branchId)
    : db.prepare(`SELECT asset_code FROM assets`).all();

  let maxSeq = 0;
  existingRows.forEach(row => {
    const code = String(row.asset_code || '').trim();
    const match = code.match(seqRegex);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  });

  let nextSeq = maxSeq + 1;

  const buildCode = (seqNum) => {
    let result = pattern
      .replace(/\{BRANCH\}/gi, branchCode)
      .replace(/\{YYYY\}/gi, yyyy)
      .replace(/\{YYMMDD\}/gi, yymmdd)
      .replace(/\{YY\}/gi, yy)
      .replace(/\{MM\}/gi, mm)
      .replace(/\{DD\}/gi, dd);

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