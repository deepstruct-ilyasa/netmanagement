const db = require('../db');

function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const key = parts.shift().trim();
    const val = decodeURIComponent(parts.join('='));
    list[key] = val;
  });
  return list;
}

function branchContext(req, res, next) {
  const allBranches = db.prepare('SELECT id, branch_code, branch_name FROM branches ORDER BY branch_name ASC').all();

  let accessibleBranches = [];
  if (req.user && (req.user.role === 'administrator' || req.user.all_branches === 1)) {
    // Administrator & user dengan scope All Branches otomatis mendapat seluruh cabang (existing & baru)
    accessibleBranches = allBranches;
  } else if (req.user && Array.isArray(req.user.allowed_branch_ids)) {
    accessibleBranches = allBranches.filter(b => req.user.allowed_branch_ids.includes(b.id));
  }

  const cookies = parseCookies(req.headers.cookie);
  let selectedBranchId = req.query.branch_id || cookies.selected_branch_id || 'all';

  if (accessibleBranches.length === 0) {
    selectedBranchId = 'none';
  } else if (accessibleBranches.length === 1) {
    selectedBranchId = String(accessibleBranches[0].id);
  } else if (selectedBranchId !== 'all') {
    const isValid = accessibleBranches.some(b => String(b.id) === String(selectedBranchId));
    if (!isValid) {
      selectedBranchId = 'all';
    }
  }

  req.selectedBranchId = selectedBranchId;
  req.accessibleBranches = accessibleBranches;

  res.locals.navBranches = accessibleBranches;
  res.locals.selectedBranchId = selectedBranchId;

  next();
}

module.exports = branchContext;