const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dbDir = path.join(__dirname, 'database');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(path.join(dbDir, 'netmanagement.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

db.exec(`
  -- 0. Global Application Settings (Zero-Hardcode Configuration)
  CREATE TABLE IF NOT EXISTS app_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL,
    description TEXT,
    updated_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  -- 1. Branches Table
  CREATE TABLE IF NOT EXISTS branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_code TEXT NOT NULL UNIQUE,
    branch_name TEXT NOT NULL,
    address TEXT,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  -- 2. Master Device Types Table
  CREATE TABLE IF NOT EXISTS device_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type_name TEXT NOT NULL UNIQUE,
    is_switch INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  -- 3. Master Brands / Manufactures Table
  CREATE TABLE IF NOT EXISTS brands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_name TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  -- 4. Master Device Models Table
  CREATE TABLE IF NOT EXISTS device_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_id INTEGER NOT NULL,
    device_type_id INTEGER,
    model_name TEXT NOT NULL,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours')),
    UNIQUE(brand_id, model_name),
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
    FOREIGN KEY (device_type_id) REFERENCES device_types(id) ON DELETE SET NULL
  );

  -- 5. Master Assets Table (Single Source of Truth)
  CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_code TEXT NOT NULL UNIQUE,
    branch_id INTEGER NOT NULL,
    device_type_id INTEGER NOT NULL,
    brand_id INTEGER,
    model_id INTEGER,
    serial_number TEXT UNIQUE,
    mac_address TEXT,
    status TEXT NOT NULL DEFAULT 'spare',       -- 'spare' | 'active' | 'maintenance' | 'broken' | 'disposed'
    condition TEXT NOT NULL DEFAULT 'good',     -- 'good' | 'fair' | 'damaged'
    purchase_date DATE,
    warranty_end DATE,
    vendor_name TEXT,
    purchase_price INTEGER DEFAULT 0,
    physical_photo TEXT,
    sn_photo TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours')),
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
    FOREIGN KEY (device_type_id) REFERENCES device_types(id) ON DELETE RESTRICT,
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL,
    FOREIGN KEY (model_id) REFERENCES device_models(id) ON DELETE SET NULL
  );

  -- 6. Network Devices Table (Operational Layer linked to Assets)
  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER UNIQUE,
    branch_id INTEGER NOT NULL,
    device_type_id INTEGER NOT NULL,
    brand_id INTEGER,
    model_id INTEGER,
    hostname TEXT NOT NULL,
    brand TEXT,
    model TEXT,
    switch_management TEXT,
    is_poe INTEGER DEFAULT 0,
    ip_address TEXT,
    mac_address TEXT,
    serial_number TEXT,
    room_location TEXT,
    port_layout TEXT DEFAULT '2_row',
    faceplate_template TEXT DEFAULT 'rackmount',
    physical_photo TEXT,
    sn_photo TEXT,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours')),
    FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (device_type_id) REFERENCES device_types(id) ON DELETE RESTRICT,
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL,
    FOREIGN KEY (model_id) REFERENCES device_models(id) ON DELETE SET NULL
  );

  -- 7. Auto-Generated Device Ports Table
  CREATE TABLE IF NOT EXISTS device_ports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    port_number INTEGER NOT NULL,
    port_name TEXT NOT NULL,
    port_type TEXT NOT NULL,
    port_capacity TEXT DEFAULT '1G',
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
  );

  -- 8. Port-to-Port Connections Table
  CREATE TABLE IF NOT EXISTS connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_port_id INTEGER NOT NULL UNIQUE,
    target_port_id INTEGER UNIQUE,
    end_device_info TEXT,
    cable_type TEXT DEFAULT 'UTP Cat6',
    link_speed TEXT DEFAULT '1G',
    vlan_info TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours')),
    FOREIGN KEY (source_port_id) REFERENCES device_ports(id) ON DELETE CASCADE,
    FOREIGN KEY (target_port_id) REFERENCES device_ports(id) ON DELETE SET NULL
  );

  -- 9. Asset Movements / Mutation History Table
  CREATE TABLE IF NOT EXISTS asset_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL,
    movement_type TEXT NOT NULL,                -- 'DEPLOY' | 'DISMANTLE' | 'MUTASI_CABANG' | 'PINDAH_RUANG' | 'DISPOSAL'
    from_branch_id INTEGER,
    to_branch_id INTEGER,
    from_location TEXT,
    to_location TEXT,
    moved_by TEXT NOT NULL,
    movement_date DATETIME DEFAULT (datetime('now', '+7 hours')),
    notes TEXT,
    FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
    FOREIGN KEY (from_branch_id) REFERENCES branches(id) ON DELETE SET NULL,
    FOREIGN KEY (to_branch_id) REFERENCES branches(id) ON DELETE SET NULL
  );

  -- 10. Asset Maintenances / Repair History Table
  CREATE TABLE IF NOT EXISTS asset_maintenances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL,
    issue_date DATE NOT NULL,
    resolved_date DATE,
    problem_description TEXT NOT NULL,
    action_taken TEXT,
    service_vendor TEXT DEFAULT 'Internal IT',
    cost INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open',        -- 'open' | 'resolved' | 'unrepairable'
    created_by TEXT,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours')),
    FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
  );

  -- 11. Users Table
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'branch_user',
    all_branches INTEGER NOT NULL DEFAULT 0,
    allowed_menus TEXT NOT NULL DEFAULT '["topology","assets","devices"]',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  -- 12. User Branch Access
  CREATE TABLE IF NOT EXISTS user_branches (
    user_id INTEGER NOT NULL,
    branch_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, branch_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
  );

  -- 13. Audit Logs Table
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT NOT NULL,
    user_fullname TEXT NOT NULL,
    branch_id INTEGER,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    description TEXT NOT NULL,
    ip_address TEXT,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
  );

  -- 14. Audit Aset Table
  CREATE TABLE IF NOT EXISTS asset_audits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_code TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    branch_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'in_progress', -- 'in_progress' | 'closed'
    notes TEXT,
    is_reconciled INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER,
    started_at TEXT DEFAULT (datetime('now', 'localtime')),
    completed_at TEXT,
    FOREIGN KEY (branch_id) REFERENCES branches(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  -- 15. Audit Aset User Table
  CREATE TABLE IF NOT EXISTS asset_audit_assignees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    assigned_at TEXT DEFAULT (datetime('now', 'localtime')),
    UNIQUE(audit_id, user_id),
    FOREIGN KEY (audit_id) REFERENCES asset_audits(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- 16. Audit Aset Item Table
  CREATE TABLE IF NOT EXISTS asset_audit_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_id INTEGER NOT NULL,
    asset_id INTEGER,
    expected_branch_id INTEGER,
    found_branch_id INTEGER,
    expected_status TEXT,
    expected_condition TEXT,
    actual_condition TEXT,
    finding_type TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'matched' | 'condition_mismatch' | 'misplaced' | 'missing' | 'unregistered'
    unregistered_name TEXT,
    unregistered_type TEXT,
    unregistered_brand_model TEXT,
    unregistered_sn TEXT,
    unregistered_location TEXT,
    photo_evidence TEXT,
    notes TEXT,
    scanned_by INTEGER,
    scanned_at TEXT,
    FOREIGN KEY (audit_id) REFERENCES asset_audits(id) ON DELETE CASCADE,
    FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL,
    FOREIGN KEY (scanned_by) REFERENCES users(id) ON DELETE SET NULL
  );
`);

// Seed Default Settings (Zero-Hardcode Asset Code Format)
const insertSetting = db.prepare(`
  INSERT OR IGNORE INTO app_settings (setting_key, setting_value, description)
  VALUES (?, ?, ?)
`);
insertSetting.run(
  'asset_code_format',
  'INV/{BRANCH}/{YYMMDD}/{SEQ:6}',
  'Pola format kode aset otomatis. Variabel: {BRANCH}, {YYYY}, {YY}, {MM}, {DD}, {YYMMDD}, {SEQ:6}'
);
insertSetting.run(
  'organization_name',
  'IT Network Engineer',
  'Nama instansi/perusahaan yang dicetak pada label QR aset'
);

// Seed 1 default branch if empty
const countBranch = db.prepare('SELECT COUNT(*) as total FROM branches').get();
if (countBranch.total === 0) {
  db.prepare('INSERT INTO branches (branch_code, branch_name, address) VALUES (?, ?, ?)').run(
    'HO',
    'Head Office',
    '-'
  );
}

// Seed default device types if empty
const countTypes = db.prepare('SELECT COUNT(*) as total FROM device_types').get();
if (countTypes.total === 0) {
  const insertType = db.prepare('INSERT INTO device_types (type_name, is_switch) VALUES (?, ?)');
  insertType.run('Router', 0);
  insertType.run('Switch', 1);
  insertType.run('Access Point', 0);
  insertType.run('Home Router', 0);
  insertType.run('Firewall', 0);
  insertType.run('Modem', 0);
  insertType.run('CCTV', 0);
  insertType.run('VOIP', 0);
  insertType.run('NVR', 0);
  insertType.run('DVR', 0);
}

// Seed default brands if empty
const countBrands = db.prepare('SELECT COUNT(*) as total FROM brands').get();
if (countBrands.total === 0) {
  const insertBrand = db.prepare('INSERT INTO brands (brand_name) VALUES (?)');
  ['MikroTik', 'Ruijie', 'UniFi', 'Hikvision'].forEach(b => insertBrand.run(b));
}

// Seed default administrator user if empty (admin / admin123)
const countUsers = db.prepare('SELECT COUNT(*) as total FROM users').get();
if (countUsers.total === 0) {
  db.prepare(`
    INSERT INTO users (full_name, username, password_hash, role, all_branches, allowed_menus, is_active)
    VALUES (?, ?, ?, 'administrator', 1, ?, 1)
  `).run(
    'Administrator IT',
    'admin',
    hashPassword('admin123'),
    JSON.stringify([
      'topology',
      'assets',
      'devices',
      'branches',
      'device-types',
      'brands',
      'device-models',
      'users',
      'audit-logs'
    ])
  );
}

module.exports = db;