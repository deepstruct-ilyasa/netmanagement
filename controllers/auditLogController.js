const db = require('../db');

exports.index = (req, res) => {
  const selectedBranchId = req.selectedBranchId || 'all';
  const accessibleBranches = req.accessibleBranches || [];

  let query = `
    SELECT al.*, b.branch_code, b.branch_name
    FROM audit_logs al
    LEFT JOIN branches b ON al.branch_id = b.id
  `;
  const params = [];

  if (selectedBranchId === 'none') {
    query += ' WHERE 1 = 0';
  } else if (selectedBranchId !== 'all') {
    query += ' WHERE al.branch_id = ?';
    params.push(selectedBranchId);
  } else if (req.user.role !== 'administrator' && req.user.all_branches !== 1) {
    if (accessibleBranches.length === 0) {
      query += ' WHERE 1 = 0';
    } else {
      const placeholders = accessibleBranches.map(() => '?').join(',');
      query += ` WHERE al.branch_id IN (${placeholders})`;
      params.push(...accessibleBranches.map(b => b.id));
    }
  }

  query += ' ORDER BY al.id DESC LIMIT 500';
  const logs = db.prepare(query).all(...params);

  res.render('audit-logs', {
    title: 'Audit Logs - NetAsset Hospital',
    activeMenu: 'audit-logs',
    logs
  });
};