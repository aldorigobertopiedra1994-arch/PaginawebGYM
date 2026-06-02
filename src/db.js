'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function transaction(db, work) {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

const DEFAULT_SETTINGS = {
  instagram: '@templogym',
  facebook: '',
  whatsapp: '+593 99 999 9999',
  tiktok: '',
  address: 'Saraguro, Loja — Ecuador'
};

function openDatabase({ dataDir, seedFile }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'templo-gym.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      category TEXT NOT NULL,
      brand TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      sku TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
      description TEXT NOT NULL DEFAULT '',
      image_path TEXT NOT NULL DEFAULT '',
      image_search TEXT NOT NULL DEFAULT '',
      is_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0,1)),
      price_visible INTEGER NOT NULL DEFAULT 1 CHECK (price_visible IN (0,1)),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expires INTEGER NOT NULL
    );
  `);

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  transaction(db, () => {
    Object.entries(DEFAULT_SETTINGS).forEach(([key, value]) => insertSetting.run(key, value));
  });

  const count = db.prepare('SELECT COUNT(*) AS total FROM products').get().total;
  if (count === 0) {
    const initialProducts = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
    const insert = db.prepare(`
      INSERT INTO products
      (id, category, brand, name, detail, sku, price_cents, description, image_path, image_search, is_visible, price_visible, sort_order)
      VALUES (@id, @category, @brand, @name, @detail, @sku, @price_cents, @description, @image_path, @image_search, @is_visible, @price_visible, @sort_order)
    `);
    transaction(db, () => {
      initialProducts.forEach((row) => insert.run({
        id: row.id,
        category: row.category,
        brand: row.brand || '',
        name: row.name,
        detail: row.detail || '',
        sku: row.sku || '',
        price_cents: Math.round(Number(row.price || 0) * 100),
        description: row.description || '',
        image_path: row.image || '',
        image_search: row.image_search || '',
        is_visible: row.is_visible === false ? 0 : 1,
        price_visible: row.price_visible === false ? 0 : 1,
        sort_order: row.sort_order || row.id
      }));
    });
  }
  return db;
}

function settingsObject(db) {
  return Object.fromEntries(
    db.prepare('SELECT key, value FROM settings').all().map(row => [row.key, row.value])
  );
}

function rowToProduct(row, includeProtected = false) {
  const product = {
    id: row.id,
    category: row.category,
    brand: row.brand,
    name: row.name,
    detail: row.detail,
    sku: row.sku,
    price: row.price_visible || includeProtected ? Number((row.price_cents / 100).toFixed(2)) : null,
    description: row.description,
    image: row.image_path,
    imageSearch: row.image_search,
    hidden: !Boolean(row.is_visible),
    priceHidden: !Boolean(row.price_visible)
  };
  return product;
}

function groupProducts(rows, includeProtected = false) {
  return rows.reduce((catalog, row) => {
    const product = rowToProduct(row, includeProtected);
    if (!catalog[product.category]) catalog[product.category] = [];
    catalog[product.category].push(product);
    return catalog;
  }, {});
}

module.exports = { openDatabase, settingsObject, rowToProduct, groupProducts, transaction };
