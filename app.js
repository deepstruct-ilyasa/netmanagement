const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('./middlewares/authMiddleware');
const branchContext = require('./middlewares/branchContext');

const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const authRoutes = require('./routes/authRoutes');
const deviceRoutes = require('./routes/deviceRoutes');
const deviceTypeRoutes = require('./routes/deviceTypeRoutes');
const branchRoutes = require('./routes/branchRoutes');
const topologyRoutes = require('./routes/topologyRoutes');
const userRoutes = require('./routes/userRoutes');
const auditLogRoutes = require('./routes/auditLogRoutes');
const manufactureRoutes = require('./routes/manufactureRoutes');

const app = express();
const PORT = 3500;
const HOST = '0.0.0.0';

// Durasi mutlak session sejak login (contoh: 24 Jam dalam milidetik)
const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 1. Public Routes (Login & Logout — Tanpa requireAuth)
app.use('/', authRoutes);

// 2. Global Auth, Fixed Session Expiry Check & Branch Context Middleware
app.use(requireAuth);

// Cek masa berlaku session mutlak (TIDAK PERNAH DI-RESET saat klik/pindah halaman)
app.use((req, res, next) => {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/(?:^|;\s*)session_expires_at=(\d+)/);
  const now = Date.now();
  let expiresAt;

  if (match) {
    expiresAt = parseInt(match[1], 10);

    // Jika waktu sekarang sudah melewati batas kedaluwarsa -> paksa logout
    if (now >= expiresAt) {
      res.clearCookie('session_expires_at');
      res.clearCookie('last_activity');
      res.clearCookie('session_token');
      res.clearCookie('token');
      res.clearCookie('connect.sid');

      if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
        return res.status(401).json({ error: 'Session expired', redirect: '/login?expired=1' });
      }
      return res.redirect('/login?expired=1');
    }
  } else {
    // Diset HANYA SEKALI saat sesi baru dimulai setelah login
    expiresAt = now + SESSION_TIMEOUT_MS;
    res.cookie('session_expires_at', String(expiresAt), {
      maxAge: SESSION_TIMEOUT_MS,
      httpOnly: false,
      sameSite: 'lax'
    });
  }

  // Kirim waktu kedaluwarsa asli & durasi awal ke EJS
  res.locals.sessionExpiresAt = expiresAt;
  res.locals.sessionTimeoutMs = SESSION_TIMEOUT_MS;
  next();
});

app.use(branchContext);

// 3. Wajib mengarah ke Topology sebagai halaman utama setelah login
app.get('/', (req, res) => {
  return res.redirect('/topology');
});

// 4. Branch Switcher di Sidebar
app.post('/set-branch', (req, res) => {
  const { branch_id, redirect_to } = req.body;
  const targetBranch = branch_id || 'all';

  res.cookie('selected_branch_id', targetBranch, {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: false,
    sameSite: 'lax'
  });

  const backUrl = redirect_to && redirect_to.startsWith('/') ? redirect_to : '/topology';
  res.redirect(backUrl);
});

// 5. Protected Application Routes
app.use('/', deviceRoutes);
app.use('/', deviceTypeRoutes);
app.use('/', branchRoutes);
app.use('/', topologyRoutes);
app.use('/', userRoutes);
app.use('/', auditLogRoutes);
app.use('/', manufactureRoutes);

app.listen(PORT, HOST, () => {
  console.log(`Server berjalan di http://${HOST}:${PORT}`);
});