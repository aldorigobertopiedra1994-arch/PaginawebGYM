'use strict';

require('dotenv').config();
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { openDatabase } = require('../src/db');

const username = String(process.argv[2] || '').trim();
const password = String(process.argv[3] || '');
if (!username || password.length < 8) {
  console.error('Uso: npm run admin:create -- admin "UnaClaveSeguraDe8OMas"');
  process.exit(1);
}
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '../data/runtime'));
const db = openDatabase({ dataDir, seedFile: path.join(__dirname, '../data/seed-products.json') });
const hash = bcrypt.hashSync(password, 12);
db.prepare(`
  INSERT INTO admins (username, password_hash)
  VALUES (?, ?)
  ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash, updated_at=CURRENT_TIMESTAMP
`).run(username, hash);
console.log(`Administrador "${username}" creado/actualizado correctamente.`);
db.close();
