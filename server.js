const express = require('express');
const session = require('express-session');
const path = require('path');
const bodyParser = require('body-parser');
const fs = require('fs');
const multer = require('multer');
const db = require('./db');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({ secret: 'spicedums-secret', resave: false, saveUninitialized: false }));

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  req.session.cart = req.session.cart || [];
  res.locals.cartCount = Array.isArray(req.session.cart) ? req.session.cart.reduce((a, b) => a + (b.qty || 0), 0) : 0;
  next();
});

async function ensureSchema() {
  try {
    await db.query('CREATE TABLE IF NOT EXISTS products (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), description TEXT, price DECIMAL(10,2) NOT NULL, image VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
    const [[pc]] = await db.query("SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='products' AND COLUMN_NAME='cost'");
    if (!pc.c) {
      await db.query('ALTER TABLE products ADD COLUMN cost DECIMAL(10,2) NOT NULL DEFAULT 0');
    }
    await db.query('CREATE TABLE IF NOT EXISTS orders (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NULL, total DECIMAL(10,2) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
    await db.query('CREATE TABLE IF NOT EXISTS order_items (id INT AUTO_INCREMENT PRIMARY KEY, order_id INT NOT NULL, product_id INT NOT NULL, qty INT NOT NULL, price DECIMAL(10,2) NOT NULL, cost DECIMAL(10,2) NOT NULL DEFAULT 0, FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE)');
    const [[oc]] = await db.query("SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='order_items' AND COLUMN_NAME='cost'");
    if (!oc.c) {
      await db.query('ALTER TABLE order_items ADD COLUMN cost DECIMAL(10,2) NOT NULL DEFAULT 0');
    }
  } catch (_) {}
}
ensureSchema();

// Home
app.get('/', async (req, res) => {
  let products = [];
  try {
    const [rows] = await db.query('SELECT * FROM products');
    products = rows;
  } catch (_) {
    products = [];
  }
  let reviews = [];
  try {
    const [rows] = await db.query('SELECT r.*, u.username FROM reviews r JOIN users u ON r.user_id = u.id ORDER BY r.created_at DESC LIMIT 6');
    reviews = rows;
  } catch (err) {
    reviews = [];
  }
  const resolvePath = (img) => {
    const placeholder = '/images/placeholder.png';
    if (!img || typeof img !== 'string') return placeholder;
    const normalized = img.startsWith('/') ? img : ('/' + img);
    const candidate = path.join(__dirname, 'public', normalized.replace(/^\//, ''));
    if (fs.existsSync(candidate)) return normalized;
    if (normalized.startsWith('/images/')) {
      const base = path.basename(normalized);
      const alt = path.join(__dirname, 'public', 'uploads', base);
      if (fs.existsSync(alt)) return '/uploads/' + base;
    }
    return placeholder;
  };
  const productsResolved = products.map(p => ({ ...p, imageResolved: resolvePath(p.image) }));
  res.render('home', { products: productsResolved, reviews, cartCount: res.locals.cartCount });
});

// File upload setup for product images
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const time = Date.now();
    const safeBase = (file.originalname || 'image').replace(/[^a-zA-Z0-9.\-]/g, '_');
    cb(null, `${time}-${safeBase}`);
  }
});
const fileFilter = (req, file, cb) => {
  const ok = /\.(png|jpg|jpeg|gif|webp)$/i.test(file.originalname || '');
  cb(ok ? null : new Error('Invalid file type'), ok);
};
const upload = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } });
