const db = require('../db');

function logAudit(req, { action, entityType, entityId = null, branchId = null, description }) {
  try {
    const user = req.user || {};
    const rawIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '-';
    const ipAddress = String(rawIp).split(',')[0].trim();

    db.prepare(`
      INSERT INTO audit_logs (
        user_id, username, user_fullname, branch_id, action, entity_type, entity_id, description, ip_address
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id || null,
      user.username || 'system',
      user.full_name || 'System',
      branchId || null,
      action,
      entityType,
      entityId,
      description,
      ipAddress
    );
  } catch (err) {
    console.error('[AuditLogger Error]', err.message);
  }
}

module.exports = { logAudit };