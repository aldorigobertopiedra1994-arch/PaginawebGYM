'use strict';

require('dotenv').config();

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { openDatabase, settingsObject, groupProducts, transaction } = require('./src/db');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data/runtime'));
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, 'storage/uploads'));
const SESSION_SECRET = process.env.SESSION_SECRET || '';

if (SESSION_SECRET.length < 32) {
  throw new Error('Configura SESSION_SECRET con al menos 32 caracteres en tu archivo .env o en el hosting.');
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const db = openDatabase({
  dataDir: DATA_DIR,
  seedFile: path.join(__dirname, 'data/seed-products.json')
});

class SQLiteSessionStore extends session.Store {
  constructor(database) {
    super();
    this.db = database;
    this.getStmt = database.prepare('SELECT sess, expires FROM sessions WHERE sid = ?');
    this.setStmt = database.prepare('INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires');
    this.destroyStmt = database.prepare('DELETE FROM sessions WHERE sid = ?');
    this.cleanupStmt = database.prepare('DELETE FROM sessions WHERE expires < ?');
  }
  get(sid, callback) {
    try {
      this.cleanupStmt.run(Date.now());
      const row = this.getStmt.get(sid);
      if (!row || row.expires < Date.now()) return callback(null, null);
      callback(null, JSON.parse(row.sess));
    } catch (error) { callback(error); }
  }
  set(sid, sess, callback) {
    try {
      const expires = sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 1000 * 60 * 60 * 8;
      this.setStmt.run(sid, JSON.stringify(sess), expires);
      callback && callback(null);
    } catch (error) { callback && callback(error); }
  }
  destroy(sid, callback) {
    try {
      this.destroyStmt.run(sid);
      callback && callback(null);
    } catch (error) { callback && callback(error); }
  }
  touch(sid, sess, callback) { this.set(sid, sess, callback); }
}

if (isProduction) app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: isProduction ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(express.json({ limit: '40kb' }));
app.use(express.urlencoded({ extended: false, limit: '40kb' }));

app.use(session({
  name: 'tg.sid',
  secret: SESSION_SECRET,
  store: new SQLiteSessionStore(db),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 8
  }
}));

function newCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}
function csrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = newCsrfToken();
  return req.session.csrfToken;
}
function sameToken(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
function requireCsrf(req, res, next) {
  if (!sameToken(req.get('x-csrf-token'), req.session.csrfToken)) {
    return res.status(403).json({ error: 'Solicitud no autorizada. Recarga la página e inténtalo nuevamente.' });
  }
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.adminId) return res.status(401).json({ error: 'Inicia sesión como administrador.' });
  const admin = db.prepare('SELECT id, username FROM admins WHERE id = ?').get(req.session.adminId);
  if (!admin) return res.status(401).json({ error: 'Sesión inválida.' });
  req.admin = admin;
  next();
}

function cleanText(value, max = 150) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
function validBoolean(value, fallback = true) {
  if (value === undefined) return fallback;
  return String(value) === 'true' || value === true || value === 1 || value === '1';
}
function parseProduct(body, existing = null) {
  const category = cleanText(body.category ?? existing?.category, 60);
  const name = cleanText(body.name ?? existing?.name, 140);
  if (!category || !name) throw new Error('La categoría y el nombre son obligatorios.');
  const rawPrice = Number(body.price ?? (existing ? existing.price_cents / 100 : 0));
  if (!Number.isFinite(rawPrice) || rawPrice < 0 || rawPrice > 100000) throw new Error('Precio inválido.');
  return {
    category,
    brand: cleanText(body.brand ?? existing?.brand, 100),
    name,
    detail: cleanText(body.detail ?? existing?.detail, 100),
    sku: cleanText(body.sku ?? existing?.sku, 80),
    price_cents: Math.round(rawPrice * 100),
    description: cleanText(body.description ?? existing?.description, 750),
    is_visible: validBoolean(body.isVisible, existing ? Boolean(existing.is_visible) : true) ? 1 : 0,
    price_visible: validBoolean(body.priceVisible, existing ? Boolean(existing.price_visible) : true) ? 1 : 0
  };
}

const imageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype];
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext || ''}`);
  }
});
const upload = multer({
  storage: imageStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return cb(new Error('Solo se permiten imágenes JPG, PNG o WEBP.'));
    }
    cb(null, true);
  }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Inténtalo nuevamente en 15 minutos.' }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/auth/csrf', (req, res) => res.json({ csrfToken: csrfToken(req) }));
app.get('/api/auth/me', (req, res) => {
  const token = csrfToken(req);
  if (!req.session.adminId) return res.json({ authenticated: false, csrfToken: token });
  const admin = db.prepare('SELECT id, username FROM admins WHERE id = ?').get(req.session.adminId);
  if (!admin) return res.json({ authenticated: false, csrfToken: token });
  res.json({ authenticated: true, username: admin.username, csrfToken: token });
});
app.post('/api/auth/login', loginLimiter, requireCsrf, (req, res, next) => {
  const username = cleanText(req.body.username, 60);
  const password = String(req.body.password || '');
  const admin = db.prepare('SELECT id, username, password_hash FROM admins WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }
  req.session.regenerate((error) => {
    if (error) return next(error);
    req.session.adminId = admin.id;
    req.session.csrfToken = newCsrfToken();
    res.json({ authenticated: true, username: admin.username, csrfToken: req.session.csrfToken });
  });
});
app.post('/api/auth/logout', requireCsrf, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('tg.sid');
    res.json({ ok: true });
  });
});

app.get('/api/catalog', (_req, res) => {
  const rows = db.prepare('SELECT * FROM products WHERE is_visible = 1 ORDER BY sort_order, id').all();
  res.json({ catalog: groupProducts(rows, false), config: settingsObject(db) });
});

app.get('/api/admin/catalog', requireAdmin, (_req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY sort_order, id').all();
  res.json({ catalog: groupProducts(rows, true), config: settingsObject(db) });
});

app.patch('/api/admin/products/price-visibility', requireAdmin, requireCsrf, (req, res) => {
  const visible = validBoolean(req.body.visible, true) ? 1 : 0;
  db.prepare('UPDATE products SET price_visible = ?, updated_at = CURRENT_TIMESTAMP').run(visible);
  res.json({ ok: true, priceVisible: Boolean(visible) });
});

app.post('/api/admin/products', requireAdmin, requireCsrf, upload.single('image'), (req, res) => {
  try {
    const product = parseProduct(req.body);
    const maxId = db.prepare('SELECT COALESCE(MAX(id), 0) AS maxId FROM products').get().maxId;
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS maxOrder FROM products').get().maxOrder;
    const imagePath = req.file ? `/uploads/${req.file.filename}` : 'assets/images/img-63f37be8073e.png';
    db.prepare(`
      INSERT INTO products (id, category, brand, name, detail, sku, price_cents, description, image_path, is_visible, price_visible, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(maxId + 1, product.category, product.brand, product.name, product.detail, product.sku, product.price_cents,
      product.description, imagePath, product.is_visible, product.price_visible, maxOrder + 1);
    res.status(201).json({ ok: true, id: maxId + 1 });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/admin/products/:id', requireAdmin, requireCsrf, upload.single('image'), (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Producto no encontrado.' });
    const product = parseProduct(req.body, existing);
    const imagePath = req.file ? `/uploads/${req.file.filename}` : existing.image_path;
    db.prepare(`
      UPDATE products
      SET category=?, brand=?, name=?, detail=?, sku=?, price_cents=?, description=?,
          image_path=?, is_visible=?, price_visible=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(product.category, product.brand, product.name, product.detail, product.sku, product.price_cents,
      product.description, imagePath, product.is_visible, product.price_visible, id);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.patch('/api/admin/products/:id/visibility', requireAdmin, requireCsrf, (req, res) => {
  const id = Number(req.params.id);
  const visible = validBoolean(req.body.visible, true) ? 1 : 0;
  const result = db.prepare('UPDATE products SET is_visible=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(visible, id);
  if (!result.changes) return res.status(404).json({ error: 'Producto no encontrado.' });
  res.json({ ok: true });
});

app.delete('/api/admin/products/:id', requireAdmin, requireCsrf, (req, res) => {
  const id = Number(req.params.id);
  const result = db.prepare('DELETE FROM products WHERE id = ?').run(id);
  if (!result.changes) return res.status(404).json({ error: 'Producto no encontrado.' });
  res.json({ ok: true });
});

app.put('/api/admin/settings', requireAdmin, requireCsrf, (req, res) => {
  const allowed = ['instagram', 'facebook', 'whatsapp', 'tiktok', 'address'];
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  transaction(db, () => allowed.forEach(key => upsert.run(key, cleanText(req.body[key], 150))));
  res.json({ ok: true, config: settingsObject(db) });
});

app.put('/api/admin/password', requireAdmin, requireCsrf, (req, res) => {
  const password = String(req.body.password || '');
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'La contraseña debe tener entre 8 y 128 caracteres.' });
  }
  const hash = bcrypt.hashSync(password, 12);
  db.prepare('UPDATE admins SET password_hash=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(hash, req.admin.id);
  res.json({ ok: true });
});

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: isProduction ? '7d' : 0 }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProduction ? '1d' : 0, etag: true }));
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: 'La imagen excede el tamaño máximo de 2 MB.' });
  }
  if (error && error.message && error.message.includes('imágenes')) {
    return res.status(400).json({ error: error.message });
  }
  console.error(error);
  res.status(500).json({ error: 'Ocurrió un error interno.' });
});

app.listen(PORT, () => {
  console.log(`Templo GYM activo en http://localhost:${PORT}`);
});
