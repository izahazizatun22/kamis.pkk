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

// Product detail
app.get('/product/:id', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
  if (!rows[0]) return res.status(404).send('Product not found');
  const productRaw = rows[0];
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
  const product = { ...productRaw, imageResolved: resolvePath(productRaw.image) };
  let reviews = [];
  try {
    const [rows] = await db.query('SELECT r.*, u.username FROM reviews r JOIN users u ON r.user_id = u.id WHERE r.product_id = ?', [product.id]);
    reviews = rows;
  } catch (err) {
    reviews = [];
  }
  res.render('product', { product, reviews, cartCount: res.locals.cartCount });
});

// Register
app.get('/register', (req, res) => res.render('register'));
app.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.redirect('/register');
  const [exists] = await db.query('SELECT id FROM users WHERE email = ? OR username = ?', [email, username]);
  if (exists.length) return res.send('User already exists');
  await db.query('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)', [username, email, password, 'customer']);
  res.redirect('/login');
});

// Login
app.get('/login', (req, res) => {
  const error = req.session.authError || null;
  req.session.authError = null;
  const username = req.query.u || '';
  res.render('login', { error, username });
});
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const [rows] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
  const user = rows[0];
  if (!user || user.password !== password) {
    req.session.authError = 'Username atau password salah';
    return res.redirect('/login?u=' + encodeURIComponent(username || ''));
  }
  req.session.user = { id: user.id, username: user.username, role: user.role };
  res.redirect('/');
});

// Logout
app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// Checkout (simple)
app.post('/checkout', async (req, res) => {
  const { product_id, qty } = req.body;
  const pid = parseInt(product_id, 10);
  const quantity = Math.max(1, parseInt(qty, 10) || 1);
  const [rows] = await db.query('SELECT id, price, name, cost FROM products WHERE id = ?', [pid]);
  const prod = rows[0];
  if (!prod) return res.redirect('/');
  const total = Number(prod.price) * quantity;

  await db.query('CREATE TABLE IF NOT EXISTS orders (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NULL, total DECIMAL(10,2) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
  await db.query('CREATE TABLE IF NOT EXISTS order_items (id INT AUTO_INCREMENT PRIMARY KEY, order_id INT NOT NULL, product_id INT NOT NULL, qty INT NOT NULL, price DECIMAL(10,2) NOT NULL, cost DECIMAL(10,2) NOT NULL DEFAULT 0, FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE)');
  await db.query('INSERT INTO orders (user_id, total) VALUES (?, ?)', [req.session.user ? req.session.user.id : null, total]);
  const [[orderRow]] = await db.query('SELECT LAST_INSERT_ID() AS id');
  const orderId = orderRow.id;
  await db.query('INSERT INTO order_items (order_id, product_id, qty, price, cost) VALUES (?, ?, ?, ?, ?)', [orderId, prod.id, quantity, Number(prod.price), Number(prod.cost || 0)]);

  const userLine = req.session.user ? `Saya ${req.session.user.username}.` : '';
  const message = `Halo Spice Dums. ${userLine}\nID Pesanan: #${orderId}\nOrder:\n- ${prod.name} x${quantity} @ Rp ${Number(prod.price).toLocaleString('id-ID')}\nSubtotal: Rp ${Number(total).toLocaleString('id-ID')}\nMohon konfirmasi.`;
  const wa = 'https://wa.me/6285775211374?text=' + encodeURIComponent(message);
  res.redirect(wa);
});

// Submit review
app.post('/product/:id/review', async (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const { rating, comment } = req.body;
  await db.query('INSERT INTO reviews (product_id, user_id, rating, comment) VALUES (?, ?, ?, ?)', [req.params.id, req.session.user.id, rating || 5, comment || '']);
  res.redirect('/product/' + req.params.id);
});

// Admin reports
app.get('/admin/reports', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send('Forbidden');
  try {
    let period = String((req.query.period || 'week')).toLowerCase();
    const valid = ['day', 'week', 'month', 'year'];
    if (!valid.includes(period)) period = 'week';
    const qFrom = typeof req.query.from === 'string' ? req.query.from : '';
    const qTo = typeof req.query.to === 'string' ? req.query.to : '';

    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const today = new Date();
    const defaultFromDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
    const defaultToDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const fromDateStr = /^\d{4}-\d{2}-\d{2}$/.test(qFrom) ? qFrom : fmt(defaultFromDate);
    const toDateStr = /^\d{4}-\d{2}-\d{2}$/.test(qTo) ? qTo : fmt(defaultToDate);

    let where = `DATE(created_at) BETWEEN '${fromDateStr}' AND '${toDateStr}'`;
    let trendSql = 'SELECT DATE(created_at) AS day, COALESCE(SUM(total),0) AS revenue, COUNT(*) AS count FROM orders WHERE ' + where + ' GROUP BY DATE(created_at) ORDER BY day ASC';
    let trendTitleLabel = '7 Hari Terakhir';
    let groupHeader = 'Tanggal';
    let periodLabel = `Range: ${fromDateStr} s/d ${toDateStr}`;
    let dailySql = 'SELECT DATE(created_at) AS day, COALESCE(SUM(total),0) AS revenue, COUNT(*) AS count FROM orders WHERE ' + where + ' GROUP BY DATE(created_at) ORDER BY day DESC';

    if (period === 'year') {
      trendSql = 'SELECT DATE_FORMAT(created_at, "%Y-%m") AS day, COALESCE(SUM(total),0) AS revenue, COUNT(*) AS count FROM orders WHERE ' + where + ' GROUP BY YEAR(created_at), MONTH(created_at) ORDER BY day ASC';
      groupHeader = 'Bulan';
      dailySql = 'SELECT DATE_FORMAT(created_at, "%Y-%m") AS day, COALESCE(SUM(total),0) AS revenue, COUNT(*) AS count FROM orders WHERE ' + where + ' GROUP BY YEAR(created_at), MONTH(created_at) ORDER BY day DESC';
    }

    const whereAliased = where.replaceAll('created_at', 'o.created_at');

    const [sales] = await db.query('SELECT o.id, o.total, COALESCE(u.username, "Guest") AS username, o.created_at FROM orders o LEFT JOIN users u ON o.user_id = u.id WHERE ' + whereAliased + ' ORDER BY o.created_at DESC');
    const [itemsRows] = await db.query('SELECT oi.order_id, oi.product_id, oi.qty, oi.price, COALESCE(oi.cost, p.cost) AS cost, COALESCE(p.name, "Produk") AS name FROM order_items oi JOIN orders o ON oi.order_id = o.id LEFT JOIN products p ON oi.product_id = p.id WHERE ' + whereAliased);
    const itemsByOrderId = new Map();
    for (const r of itemsRows) {
      const arr = itemsByOrderId.get(r.order_id) || [];
      arr.push({ product_id: r.product_id, name: r.name, qty: Number(r.qty), price: Number(r.price) });
      itemsByOrderId.set(r.order_id, arr);
    }
    const salesDetailed = sales.map(s => ({ ...s, items: itemsByOrderId.get(s.id) || [] }));
    const [sumRows] = await db.query('SELECT COALESCE(SUM(total),0) AS revenue FROM orders WHERE ' + where);
    const [countRows] = await db.query('SELECT COUNT(*) AS count FROM orders WHERE ' + where);
    const [costRows] = await db.query('SELECT COALESCE(SUM(COALESCE(oi.cost, p.cost) * oi.qty),0) AS cost FROM order_items oi JOIN orders o ON oi.order_id = o.id LEFT JOIN products p ON oi.product_id = p.id WHERE ' + whereAliased);
    const [todayRows] = await db.query('SELECT COALESCE(SUM(total),0) AS revenue, COUNT(*) AS count FROM orders WHERE DATE(created_at)=CURDATE()');
    const [weekRows] = await db.query('SELECT COALESCE(SUM(total),0) AS revenue, COUNT(*) AS count FROM orders WHERE created_at >= NOW() - INTERVAL 7 DAY');
    const [monthRows] = await db.query('SELECT COALESCE(SUM(total),0) AS revenue, COUNT(*) AS count FROM orders WHERE YEAR(created_at)=YEAR(CURDATE()) AND MONTH(created_at)=MONTH(CURDATE())');
    const [trendDays] = await db.query(trendSql);
    const [dailyDays] = await db.query(dailySql);
    const [salesByUser] = await db.query('SELECT COALESCE(u.username, "Guest") AS username, COUNT(o.id) AS orders, COALESCE(SUM(o.total),0) AS revenue FROM orders o LEFT JOIN users u ON o.user_id = u.id WHERE ' + whereAliased + ' GROUP BY COALESCE(u.username, "Guest") ORDER BY revenue DESC');
    const [salesByProduct] = await db.query('SELECT COALESCE(p.name, "Produk") AS product_name, COALESCE(SUM(oi.qty),0) AS qty, COALESCE(SUM(oi.qty * oi.price),0) AS revenue FROM order_items oi JOIN orders o ON oi.order_id = o.id LEFT JOIN products p ON oi.product_id = p.id WHERE ' + whereAliased + ' GROUP BY oi.product_id, COALESCE(p.name, "Produk") ORDER BY revenue DESC');

    let reviewsOverall = [{ count: 0, avg_rating: 0 }];
    let reviewsRecent = [{ count: 0, avg_rating: 0 }];
    try {
      const [ro] = await db.query('SELECT COUNT(*) AS count, COALESCE(AVG(rating),0) AS avg_rating FROM reviews');
      reviewsOverall = ro.length ? ro : reviewsOverall;
    } catch {}
    try {
      const [rr] = await db.query('SELECT COUNT(*) AS count, COALESCE(AVG(rating),0) AS avg_rating FROM reviews WHERE created_at >= NOW() - INTERVAL 7 DAY');
      reviewsRecent = rr.length ? rr : reviewsRecent;
    } catch {}

    const revenue = sumRows[0]?.revenue || 0;
    const ordersCount = countRows[0]?.count || 0;
    const aov = ordersCount ? revenue / ordersCount : 0;
    const cost = costRows[0]?.cost || 0;
    const profit = revenue - cost;

    res.render('admin-reports', {
      sales: salesDetailed,
      kpi: {
        revenue,
        ordersCount,
        aov,
        cost,
        profit,
        today: todayRows[0] || { revenue: 0, count: 0 },
        week: weekRows[0] || { revenue: 0, count: 0 },
        month: monthRows[0] || { revenue: 0, count: 0 }
      },
      trendDays,
      dailyDays,
      salesByUser,
      salesByProduct,
      salesByProduct,
      reviews: {
        overall: reviewsOverall[0] || { count: 0, avg_rating: 0 },
        recent: reviewsRecent[0] || { count: 0, avg_rating: 0 }
      },
      period,
      periodLabel,
      trendTitleLabel,
      groupHeader,
      from: fromDateStr,
      to: toDateStr
    });
  } catch (err) {
    res.render('admin-reports', {
      sales: [],
      kpi: { revenue: 0, ordersCount: 0, aov: 0, cost: 0, profit: 0, today: { revenue: 0, count: 0 }, week: { revenue: 0, count: 0 }, month: { revenue: 0, count: 0 } },
      trendDays: [],
      dailyDays: [],
      salesByUser: [],
      salesByProduct: [],
      salesByProduct: [],
      reviews: { overall: { count: 0, avg_rating: 0 }, recent: { count: 0, avg_rating: 0 } },
      period: 'range',
      periodLabel: 'Range',
      trendTitleLabel: '7 Hari Terakhir',
      groupHeader: 'Tanggal',
      from: '',
      to: ''
    });
  }
});



app.get('/admin/reports/json', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send('Forbidden');
  try {
    let period = String((req.query.period || 'week')).toLowerCase();
    const valid = ['day', 'week', 'month', 'year'];
    if (!valid.includes(period)) period = 'week';
    const qFrom = typeof req.query.from === 'string' ? req.query.from : '';
    const qTo = typeof req.query.to === 'string' ? req.query.to : '';
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (d) => `${d.getFullYear()}-${d.getMonth()+1 < 10 ? '0' : ''}${d.getMonth()+1}-${pad(d.getDate())}`;
    const today = new Date();
    const defaultFromDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
    const defaultToDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const fromDateStr = /^\d{4}-\d{2}-\d{2}$/.test(qFrom) ? qFrom : fmt(defaultFromDate);
    const toDateStr = /^\d{4}-\d{2}-\d{2}$/.test(qTo) ? qTo : fmt(defaultToDate);
    let where = `DATE(created_at) BETWEEN '${fromDateStr}' AND '${toDateStr}'`;
    let trendSql = 'SELECT DATE(created_at) AS day, COALESCE(SUM(total),0) AS revenue, COUNT(*) AS count FROM orders WHERE ' + where + ' GROUP BY DATE(created_at) ORDER BY day ASC';
    let trendTitleLabel = 'Rentang Tanggal';
    let groupHeader = 'Tanggal';
    let periodLabel = `Range: ${fromDateStr} s/d ${toDateStr}`;
    let dailySql = 'SELECT DATE(created_at) AS day, COALESCE(SUM(total),0) AS revenue, COUNT(*) AS count FROM orders WHERE ' + where + ' GROUP BY DATE(created_at) ORDER BY day DESC';
    if (period === 'year') {
      trendSql = 'SELECT DATE_FORMAT(created_at, "%Y-%m") AS day, COALESCE(SUM(total),0) AS revenue, COUNT(*) AS count FROM orders WHERE ' + where + ' GROUP BY YEAR(created_at), MONTH(created_at) ORDER BY day ASC';
      groupHeader = 'Bulan';
      dailySql = 'SELECT DATE_FORMAT(created_at, "%Y-%m") AS day, COALESCE(SUM(total),0) AS revenue, COUNT(*) AS count FROM orders WHERE ' + where + ' GROUP BY YEAR(created_at), MONTH(created_at) ORDER BY day DESC';
    }
    const whereAliased = where.replaceAll('created_at', 'o.created_at');
    const [sales] = await db.query('SELECT o.id, o.total, COALESCE(u.username, "Guest") AS username, o.created_at FROM orders o LEFT JOIN users u ON o.user_id = u.id WHERE ' + whereAliased + ' ORDER BY o.created_at DESC');
    const [sumRows] = await db.query('SELECT COALESCE(SUM(total),0) AS revenue FROM orders WHERE ' + where);
    const [countRows] = await db.query('SELECT COUNT(*) AS count FROM orders WHERE ' + where);
    const [todayRows] = await db.query('SELECT COALESCE(SUM(total),0) AS revenue, COUNT(*) AS count FROM orders WHERE DATE(created_at)=CURDATE()');
    const [weekRows] = await db.query('SELECT COALESCE(SUM(total),0) AS revenue, COUNT(*) AS count FROM orders WHERE created_at >= NOW() - INTERVAL 7 DAY');
    const [monthRows] = await db.query('SELECT COALESCE(SUM(total),0) AS revenue, COUNT(*) AS count FROM orders WHERE YEAR(created_at)=YEAR(CURDATE()) AND MONTH(created_at)=MONTH(CURDATE())');
    const [trendDays] = await db.query(trendSql);
    const [dailyDays] = await db.query(dailySql);
    const [salesByUser] = await db.query('SELECT COALESCE(u.username, "Guest") AS username, COUNT(o.id) AS orders, COALESCE(SUM(o.total),0) AS revenue FROM orders o LEFT JOIN users u ON o.user_id = u.id WHERE ' + whereAliased + ' GROUP BY COALESCE(u.username, "Guest") ORDER BY revenue DESC');
    let reviewsOverall = [{ count: 0, avg_rating: 0 }];
    let reviewsRecent = [{ count: 0, avg_rating: 0 }];
    try {
      const [ro] = await db.query('SELECT COUNT(*) AS count, COALESCE(AVG(rating),0) AS avg_rating FROM reviews');
      reviewsOverall = ro.length ? ro : reviewsOverall;
    } catch {}
    try {
      const [rr] = await db.query('SELECT COUNT(*) AS count, COALESCE(AVG(rating),0) AS avg_rating FROM reviews WHERE created_at >= NOW() - INTERVAL 7 DAY');
      reviewsRecent = rr.length ? rr : reviewsRecent;
    } catch {}
    const [costRows] = await db.query('SELECT COALESCE(SUM(COALESCE(oi.cost, p.cost) * oi.qty),0) AS cost FROM order_items oi JOIN orders o ON oi.order_id = o.id LEFT JOIN products p ON oi.product_id = p.id WHERE ' + whereAliased);
    const revenue = sumRows[0]?.revenue || 0;
    const ordersCount = countRows[0]?.count || 0;
    const aov = ordersCount ? revenue / ordersCount : 0;
    const cost = costRows[0]?.cost || 0;
    const profit = revenue - cost;
    res.json({
      sales,
      kpi: {
        revenue,
        ordersCount,
        aov,
        cost,
        profit,
        today: todayRows[0] || { revenue: 0, count: 0 },
        week: weekRows[0] || { revenue: 0, count: 0 },
        month: monthRows[0] || { revenue: 0, count: 0 }
      },
      trendDays,
      dailyDays,
      salesByUser,
      reviews: {
        overall: reviewsOverall[0] || { count: 0, avg_rating: 0 },
        recent: reviewsRecent[0] || { count: 0, avg_rating: 0 }
      },
      period,
      periodLabel,
      trendTitleLabel,
      groupHeader,
      from: fromDateStr,
      to: toDateStr
    });
  } catch (err) {
    res.json({
      sales: [],
      kpi: { revenue: 0, ordersCount: 0, aov: 0, cost: 0, profit: 0, today: { revenue: 0, count: 0 }, week: { revenue: 0, count: 0 }, month: { revenue: 0, count: 0 } },
      trendDays: [],
      dailyDays: [],
      salesByUser: [],
      reviews: { overall: { count: 0, avg_rating: 0 }, recent: { count: 0, avg_rating: 0 } },
      period: 'range',
      periodLabel: 'Range',
      trendTitleLabel: '7 Hari Terakhir',
      groupHeader: 'Tanggal',
      from: '',
      to: ''
    });
  }
});

app.get('/admin/seed/orders', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send('Forbidden');
  const countRaw = parseInt(String(req.query.count || '20'), 10);
  const count = Number.isNaN(countRaw) ? 20 : Math.max(1, Math.min(countRaw, 200));
  const [products] = await db.query('SELECT id, price, cost, name FROM products');
  if (!products.length) {
    await db.query('INSERT INTO products (name, description, price, cost, image) VALUES (?,?,?,?,?)', ['Dumpling', 'Sample dumpling', 10000, 6000, '/images/placeholder.png']);
    await db.query('INSERT INTO products (name, description, price, cost, image) VALUES (?,?,?,?,?)', ['Fried Oreo', 'Sample oreo', 5000, 3000, '/images/placeholder.png']);
  }
  const [products2] = await db.query('SELECT id, price, cost, name FROM products');
  const [users] = await db.query('SELECT id FROM users');
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  for (let i = 0; i < count; i++) {
    const itemsCount = 1 + Math.floor(Math.random() * 3);
    const chosen = [];
    for (let j = 0; j < itemsCount; j++) chosen.push(pick(products2));
    const qtys = chosen.map(() => 1 + Math.floor(Math.random() * 4));
    const total = chosen.reduce((sum, p, idx) => sum + (Number(p.price) * qtys[idx]), 0);
    const userId = users.length && Math.random() < 0.8 ? pick(users).id : null;
    await db.query('INSERT INTO orders (user_id, total) VALUES (?, ?)', [userId, total]);
    const [[row]] = await db.query('SELECT LAST_INSERT_ID() AS id');
    const orderId = row.id;
    for (let k = 0; k < chosen.length; k++) {
      const p = chosen[k];
      const qty = qtys[k];
      await db.query('INSERT INTO order_items (order_id, product_id, qty, price, cost) VALUES (?, ?, ?, ?, ?)', [orderId, p.id, qty, Number(p.price), Number(p.cost || 0)]);
    }
    const dayOffset = Math.floor(Math.random() * 30);
    await db.query('UPDATE orders SET created_at = DATE_SUB(NOW(), INTERVAL ? DAY) WHERE id = ?', [dayOffset, orderId]);
  }
  const wantsJson = (req.headers['accept'] || '').includes('application/json');
  if (wantsJson) return res.json({ success: true, inserted: count });
  res.redirect('/admin/reports');
});

// Admin - Manage Products
app.get('/admin/products', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send('Forbidden');
  const [products] = await db.query('SELECT * FROM products ORDER BY created_at DESC');
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
  res.render('admin-products', { products: productsResolved });
});

app.post('/admin/products/add', upload.single('image_file'), async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send('Forbidden');
  const { name, description, price, image, cost } = req.body;
  if (!name || !price) return res.redirect('/admin/products');
  const cleanPrice = parseFloat(price);
  if (Number.isNaN(cleanPrice)) return res.redirect('/admin/products');
  const cleanCost = cost !== undefined ? parseFloat(cost) : 0;
  const finalCost = Number.isNaN(cleanCost) ? 0 : cleanCost;
  const imagePath = req.file ? ('/uploads/' + req.file.filename) : (image || '/images/placeholder.png');
  await db.query(
    'INSERT INTO products (name, description, price, cost, image) VALUES (?, ?, ?, ?, ?)',
    [name, description || '', cleanPrice, finalCost, imagePath]
  );
  res.redirect('/admin/products');
});

app.post('/admin/products/:id/edit', upload.single('image_file'), async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send('Forbidden');
  const { id } = req.params;
  const { name, description, price, image, cost } = req.body;
  if (!id) return res.status(400).send('Invalid product id');
  const cleanPrice = price !== undefined ? parseFloat(price) : null;
  if (price !== undefined && Number.isNaN(cleanPrice)) return res.redirect('/admin/products');
  const cleanCost = cost !== undefined ? parseFloat(cost) : null;
  const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [id]);
  const existing = rows[0];
  const imagePath = req.file ? ('/uploads/' + req.file.filename) : (image !== undefined && image !== '' ? image : (existing ? existing.image : '/images/placeholder.png'));
  await db.query(
    'UPDATE products SET name = ?, description = ?, price = ?, cost = ?, image = ? WHERE id = ?',
    [
      name || (existing ? existing.name : ''),
      description || (existing ? existing.description : ''),
      cleanPrice !== null ? cleanPrice : (existing ? existing.price : 0),
      cleanCost !== null && !Number.isNaN(cleanCost) ? cleanCost : (existing ? existing.cost : 0),
      imagePath,
      id
    ]
  );
  res.redirect('/admin/products');
});

// Cart
app.get('/cart', async (req, res) => {
  const items = req.session.cart || [];
  const total = items.reduce((sum, it) => sum + (it.price * it.qty), 0);
  const wantsJson = (req.headers['accept'] || '').includes('application/json');
  if (wantsJson) return res.json({ items, total });
  res.redirect('/');
});

app.post('/cart/add', async (req, res) => {
  const { product_id, qty } = req.body;
  const pid = parseInt(product_id, 10);
  const quantity = Math.max(1, parseInt(qty, 10) || 1);
  const [rows] = await db.query('SELECT id, name, price, image FROM products WHERE id = ?', [pid]);
  const p = rows[0];
  if (!p) return res.redirect('/');
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
  const existing = (req.session.cart || []).find(it => it.product_id === pid);
  if (existing) {
    existing.qty += quantity;
  } else {
    req.session.cart.push({ product_id: p.id, name: p.name, price: Number(p.price), image: resolvePath(p.image), qty: quantity });
  }
  const items = req.session.cart || [];
  const total = items.reduce((sum, it) => sum + (it.price * it.qty), 0);
  const wantsJson = (req.headers['accept'] || '').includes('application/json');
  if (wantsJson) {
    return res.json({ items, total, cartCount: items.reduce((a,b)=>a+(b.qty||0),0) });
  }
  res.redirect('/cart');
});

app.post('/cart/update', (req, res) => {
  const { product_id, qty } = req.body;
  const pid = parseInt(product_id, 10);
  const quantity = Math.max(0, parseInt(qty, 10) || 0);
  req.session.cart = (req.session.cart || []).map(it => it.product_id === pid ? { ...it, qty: quantity } : it).filter(it => it.qty > 0);
  const items = req.session.cart || [];
  const total = items.reduce((sum, it) => sum + (it.price * it.qty), 0);
  const wantsJson = (req.headers['accept'] || '').includes('application/json');
  if (wantsJson) {
    return res.json({ items, total, cartCount: items.reduce((a,b)=>a+(b.qty||0),0) });
  }
  res.redirect('/cart');
});

app.post('/cart/remove', (req, res) => {
  const { product_id } = req.body;
  const pid = parseInt(product_id, 10);
  req.session.cart = (req.session.cart || []).filter(it => it.product_id !== pid);
  const items = req.session.cart || [];
  const total = items.reduce((sum, it) => sum + (it.price * it.qty), 0);
  const wantsJson = (req.headers['accept'] || '').includes('application/json');
  if (wantsJson) {
    return res.json({ items, total, cartCount: items.reduce((a,b)=>a+(b.qty||0),0) });
  }
  res.redirect('/cart');
});

app.post('/cart/clear', (req, res) => {
  req.session.cart = [];
  const wantsJson = (req.headers['accept'] || '').includes('application/json');
  if (wantsJson) {
    return res.json({ items: [], total: 0, cartCount: 0 });
  }
  res.redirect('/cart');
});

app.post('/cart/checkout', async (req, res) => {
  const cart = req.session.cart || [];
  if (!cart.length) {
    const wantsJson = (req.headers['accept'] || '').includes('application/json');
    if (wantsJson) {
      return res.status(400).json({ error: 'Cart is empty' });
    }
    return res.redirect('/');
  }

  const ids = cart.map(it => it.product_id);
  const [rows] = ids.length ? await db.query('SELECT id, price, name, cost FROM products WHERE id IN (' + ids.map(() => '?').join(',') + ')', ids) : [[]];
  const priceMap = new Map(rows.map(r => [r.id, Number(r.price)]));
  const nameMap = new Map(rows.map(r => [r.id, r.name]));
  const costMap = new Map(rows.map(r => [r.id, Number(r.cost || 0)]));
  const total = cart.reduce((sum, it) => sum + ((priceMap.get(it.product_id) || it.price) * it.qty), 0);

  await db.query('CREATE TABLE IF NOT EXISTS orders (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NULL, total DECIMAL(10,2) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
  await db.query('CREATE TABLE IF NOT EXISTS order_items (id INT AUTO_INCREMENT PRIMARY KEY, order_id INT NOT NULL, product_id INT NOT NULL, qty INT NOT NULL, price DECIMAL(10,2) NOT NULL, cost DECIMAL(10,2) NOT NULL DEFAULT 0, FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE)');
  await db.query('INSERT INTO orders (user_id, total) VALUES (?, ?)', [req.session.user ? req.session.user.id : null, total]);
  const [[orderRow]] = await db.query('SELECT LAST_INSERT_ID() AS id');
  const orderId = orderRow.id;
  for (const it of cart) {
    const price = priceMap.get(it.product_id) || it.price;
    const cost = costMap.get(it.product_id) || 0;
    await db.query('INSERT INTO order_items (order_id, product_id, qty, price, cost) VALUES (?, ?, ?, ?, ?)', [orderId, it.product_id, it.qty, price, cost]);
  }

  req.session.cart = [];

  const wantsJson = (req.headers['accept'] || '').includes('application/json');
  if (wantsJson) {
    res.json({ success: true, total: Number(total), orderId });
  } else {
    const lines = cart.map(it => {
      const nm = nameMap.get(it.product_id) || it.name || 'Produk';
      const price = priceMap.get(it.product_id) || it.price || 0;
      return `- ${nm} x${it.qty} @ Rp ${Number(price).toLocaleString('id-ID')}`;
    }).join('\n');
    const userLine = req.session.user ? `Saya ${req.session.user.username}.` : '';
    const message = `Halo Spice Dums. ${userLine}\nID Pesanan: #${orderId}\nOrder:\n${lines}\nSubtotal: Rp ${Number(total).toLocaleString('id-ID')}\nMohon konfirmasi.`;
    const wa = 'https://wa.me/6285775211374?text=' + encodeURIComponent(message);
    res.redirect(wa);
  }
});

app.post('/admin/products/:id/delete', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send('Forbidden');
  const { id } = req.params;
  if (!id) return res.status(400).send('Invalid product id');
  await db.query('DELETE FROM products WHERE id = ?', [id]);
  res.redirect('/admin/products');
});

app.post('/admin/orders/:id/delete', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send('Forbidden');
  const { id } = req.params;
  if (!id) return res.status(400).send('Invalid order id');
  await db.query('DELETE FROM orders WHERE id = ?', [id]);
  res.redirect('/admin/reports');
});

// Fallback GET route to support deletion via link
app.get('/admin/orders/:id/delete', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send('Forbidden');
  const { id } = req.params;
  if (!id) return res.status(400).send('Invalid order id');
  await db.query('DELETE FROM orders WHERE id = ?', [id]);
  res.redirect('/admin/reports');
});

// Admin - Transactions page
app.get('/admin/transactions', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send('Forbidden');
  const q = String(req.query.q || '').trim();
  let sql = 'SELECT DISTINCT o.id, o.total, COALESCE(u.username, "Guest") AS username, o.created_at FROM orders o LEFT JOIN users u ON o.user_id = u.id LEFT JOIN order_items oi ON oi.order_id = o.id LEFT JOIN products p ON p.id = oi.product_id';
  const params = [];
  if (q) {
    sql += ' WHERE (CAST(o.id AS CHAR) LIKE ? OR COALESCE(u.username, "Guest") LIKE ? OR p.name LIKE ?)';
    params.push('%' + q + '%', '%' + q + '%', '%' + q + '%');
  }
  sql += ' ORDER BY o.created_at DESC LIMIT 200';
  const [sales] = await db.query(sql, params);
  const ids = sales.map(s => s.id);
  const [itemsRows] = ids.length ? await db.query('SELECT oi.order_id, oi.product_id, oi.qty, oi.price, COALESCE(oi.cost, p.cost) AS cost, COALESCE(p.name, "Produk") AS name FROM order_items oi LEFT JOIN products p ON oi.product_id = p.id WHERE oi.order_id IN (' + ids.map(() => '?').join(',') + ')', ids) : [[]];
  const itemsByOrderId = new Map();
  for (const r of itemsRows) {
    const arr = itemsByOrderId.get(r.order_id) || [];
    arr.push({ product_id: r.product_id, name: r.name, qty: Number(r.qty), price: Number(r.price) });
    itemsByOrderId.set(r.order_id, arr);
  }
  const salesDetailed = sales.map(s => ({ ...s, items: itemsByOrderId.get(s.id) || [] }));
  res.render('admin-transactions', { sales: salesDetailed, q });
});

app.get('/admin/transactions/:id/delete', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).send('Forbidden');
  const { id } = req.params;
  if (!id) return res.status(400).send('Invalid order id');
  await db.query('DELETE FROM orders WHERE id = ?', [id]);
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  return res.redirect('/admin/transactions' + (q ? ('?q=' + encodeURIComponent(q)) : ''));
});

const server = app.listen(PORT, () => console.log('Server running on http://localhost:' + PORT));
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    const fallback = PORT + 1;
    app.listen(fallback, () => console.log('Server running on http://localhost:' + fallback));
  } else {
    throw err;
  }
});
app.get('/cart/json', (req, res) => {
  const items = req.session.cart || [];
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
  const itemsResolved = items.map(it => ({ ...it, image: resolvePath(it.image) }));
  const total = itemsResolved.reduce((sum, it) => sum + (it.price * it.qty), 0);
  res.json({ items: itemsResolved, total, cartCount: itemsResolved.reduce((a,b)=>a+(b.qty||0),0) });
});
