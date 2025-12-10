-- Active: 1764464641130@@127.0.0.1@3306
-- Schema for Spice Dums promotional site
CREATE DATABASE IF NOT EXISTS spicedums;
USE spicedums;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'customer',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  image VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  user_id INT NOT NULL,
  rating INT DEFAULT 5,
  comment TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  total DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  qty INT NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Seed sample data
INSERT IGNORE INTO users (username, email, password, role) VALUES
('admin', 'admin@spicedums.local', 'admin123', 'admin'),
('johndoe', 'johndoe@spicedums.local', 'password123', 'customer'),
('janedoe', 'janedoe@spicedums.local', 'password123', 'customer'),
('bobsmith', 'bobsmith@spicedums.local', 'password123', 'customer');

INSERT IGNORE INTO products (name, description, price, image) VALUES
('Pangsit Tahu Goreng', 'Pangsit tahu goreng dengan bumbu khas', 7000.00, '/images/pangsit.jpg'),
('Fried Oreos', 'Oreo goreng renyah dengan taburan gula', 5000.00, '/images/oreos.jpg'),
('Chicken Dumplings', 'Juicy chicken dumplings with special sauce', 8000.00, '/images/chicken-dumplings.jpg'),
('Vegetable Spring Rolls', 'Fresh vegetable spring rolls with sweet sauce', 6000.00, '/images/spring-rolls.jpg'),
('Beef Momos', 'Delicious steamed beef momos', 9000.00, '/images/momos.jpg');

-- Dummy data for reviews
INSERT IGNORE INTO reviews (product_id, user_id, rating, comment) VALUES
(1, 1, 5, 'This is amazing! My favorite dumpling ever.'),
(1, 2, 4, 'Great taste but could be a bit crispier.'),
(1, 3, 5, 'Perfectly seasoned and crispy exterior.'),
(2, 1, 5, 'Best fried oreos I have ever tried!'),
(2, 2, 3, 'Too sweet for my taste, but well executed.'),
(2, 4, 4, 'Yummy dessert option! My kids love these.'),
(3, 1, 5, 'Savory and satisfying, great filling!'),
(3, 2, 4, 'Good but a bit too salty for me.'),
(4, 3, 5, 'Fresh and healthy, exactly what I was looking for.'),
(4, 4, 4, 'Great veggie option, will order again.'),
(5, 1, 5, 'Authentic taste, reminds me of home.'),
(5, 2, 4, 'Delicious, but a bit expensive.'),
(5, 3, 5, 'Perfectly steamed, excellent quality!');

-- Dummy data for orders
INSERT IGNORE INTO orders (user_id, total) VALUES
(1, 12000.00),
(1, 7000.00),
(1, 19000.00),
(2, 13000.00),
(2, 8000.00),
(3, 14000.00),
(3, 5000.00),
(4, 22000.00),
(4, 9000.00),
(2, 15000.00);
