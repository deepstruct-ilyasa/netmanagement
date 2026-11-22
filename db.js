const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dbDir = path.join(__dirname, 'database');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(path.join(__dirname, 'database', 'netmanagement.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

db.exec(`
  -- 1. Hospital Branches Table
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

  -- 5. Master Devices Table
  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (device_type_id) REFERENCES device_types(id) ON DELETE RESTRICT,
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL,
    FOREIGN KEY (model_id) REFERENCES device_models(id) ON DELETE SET NULL
  );

  -- 6. Auto-Generated Device Ports Table
  CREATE TABLE IF NOT EXISTS device_ports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    port_number INTEGER NOT NULL,
    port_name TEXT NOT NULL,
    port_type TEXT NOT NULL,
    port_capacity TEXT DEFAULT '1G',
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
  );

  -- 7. Port-to-Port Connections Table
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

  -- 8. Users Table (Role: 'administrator' | 'branch_user' | 'viewer')
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'branch_user',
    all_branches INTEGER NOT NULL DEFAULT 0,
    allowed_menus TEXT NOT NULL DEFAULT '["topology","devices"]',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  -- 9. User Branch Access (Pivot Table Hak Akses Cabang per User)
  CREATE TABLE IF NOT EXISTS user_branches (
    user_id INTEGER NOT NULL,
    branch_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, branch_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
  );

  -- 10. Audit Logs Table
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
`);

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
  ['MikroTik', 'Ruijie', 'UniFi', 'Cisco', 'Hikvision'].forEach(b => insertBrand.run(b));
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