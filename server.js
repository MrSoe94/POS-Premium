const express = require("express");
const session = require("express-session");
const fs = require("fs").promises;
const path = require("path");
const XLSX = require("xlsx");
const bcrypt = require("bcrypt");

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

// --- Middleware ---
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" })); // Middleware untuk parsing form data
app.use(
  session({
    secret: "a-very-strong-secret-key-for-pos",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }, // Set to true if using HTTPS
  })
);

// --- PERUBAHAN 1: Tambahkan Rute Utama untuk Pengalihan Otomatis ---
// Rute ini harus didefinisikan SEBELUM middleware express.static
app.get("/", (req, res) => {
  // Periksa apakah pengguna sudah login (memiliki session)
  if (req.session.user) {
    // Jika sudah login, arahkan ke halaman utama aplikasi (misalnya index.html)
    res.redirect("/index.html");
  } else {
    // Jika belum login, arahkan ke halaman login
    res.redirect("/login.html");
  }
});

// --- Role helpers ---
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.redirect('/login.html');
    }
    const role = req.session.user.role;
    if (!roles.includes(role)) {
      return res.status(403).send('Forbidden');
    }
    next();
  };
}

// --- Page routing rules ---
// Halaman Admin (khusus admin)
app.get('/admin', requireRole('admin'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Halaman Kasir (admin & cashier)
app.get('/kasir', requireRole('admin', 'cashier'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pos.html'));
});

// Lindungi akses langsung ke file HTML utama selain login: arahkan ke rute resmi
app.get(['/admin.html', '/pos.html', '/index.html'], (req, res) => {
  if (!req.session || !req.session.user) return res.redirect('/login.html');
  const role = req.session.user.role;
  if (req.path === '/admin.html') return role === 'admin' ? res.redirect('/admin') : res.status(403).send('Forbidden');
  if (req.path === '/pos.html') return res.redirect('/kasir');
  return role === 'admin' ? res.redirect('/admin') : res.redirect('/kasir');
});

// --- Middleware untuk file statis ---
// Diletakkan setelah rute utama agar tidak menangani '/' sebelum rute khusus kita
app.use(express.static("public"));

// Disable caching for API responses to prevent stale data in UI
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

// --- Helper Functions for JSON Database ---
const DATA_DIR = path.join(__dirname, "data");

const ensureDataDir = async () => {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
};

// Ensure data directory exists at startup
ensureDataDir().catch((e) => console.error('Failed to ensure data dir:', e));

const readData = async (filename) => {
  try {
    const filePath = path.join(DATA_DIR, filename);
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    // If file doesn't exist, return an empty array or object
    if (error.code === "ENOENT") {
      return filename.includes(".json") ? [] : {};
    }
    console.error(`Error reading ${filename}:`, error);
    return filename.includes(".json") ? [] : {};
  }
};

const writeData = async (filename, data) => {
  try {
    const filePath = path.join(DATA_DIR, filename);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error(`Error writing ${filename}:`, error);
    throw error; // Re-throw to be caught by the caller
  }
};

// --- Validation Helper Functions ---
const validateProductName = async (name, excludeId = null) => {
  const products = await readData("products.json");
  const existingProduct = products.find(
    (p) =>
      p.name && p.name.toLowerCase() === name.toLowerCase() && p.id != excludeId
  );
  return existingProduct;
};

const validateCategoryName = async (name, excludeId = null) => {
  const categories = await readData("categories.json");
  const existingCategory = categories.find(
    (c) =>
      c.name && c.name.toLowerCase() === name.toLowerCase() && c.id != excludeId
  );
  return existingCategory;
};

const validateUsername = async (username, excludeId = null) => {
  const users = await readData("users.json");
  const existingUser = users.find(
    (u) =>
      u.username &&
      u.username.toLowerCase() === username.toLowerCase() &&
      u.id != excludeId
  );
  return existingUser;
};

// --- Authentication Middleware ---
// --- PERUBAHAN 2: Peningkatan Middleware untuk API ---
// Untuk API, lebih baik mengembalikan error JSON daripada redirect HTML
const isAuthenticated = (req, res, next) => {
  if (req.session.user) {
    next();
  } else {
    res
      .status(401)
      .json({ success: false, message: "Unauthorized. Please log in." });
  }
};

const isAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.role === "admin") {
    next();
  } else {
    res
      .status(403)
      .json({ success: false, message: "Access Denied: Admins only" });
  }
};

// --- API Routes ---

// Auth
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Username and password are required.",
        });
    }
    const users = await readData("users.json");
    const user = users.find((u) => u.username === username.trim());

    if (user) {
      const isMatch = await bcrypt.compare(password, user.password);

      if (isMatch) {
        req.session.user = {
          id: user.id,
          username: user.username,
          role: user.role,
          name: user.name,
        };
        res.json({ success: true, role: user.role });
      } else {
        res
          .status(401)
          .json({ success: false, message: "Invalid credentials" });
      }
    } else {
      res.status(401).json({ success: false, message: "Invalid credentials" });
    }
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err)
      return res
        .status(500)
        .json({ success: false, message: "Could not log out." });
    res.json({ success: true, message: "Logged out successfully." });
  });
});

app.get("/api/auth/status", (req, res) => {
  if (req.session.user) {
    res.json({ authenticated: true, user: req.session.user });
  } else {
    res.json({ authenticated: false });
  }
});

// --- Banner & QRIS APIs ---
// New: single-object Banner endpoints
app.get('/api/banner', isAuthenticated, async (req, res) => {
  try {
    const raw = await readData('banners.json');
    // Support legacy array file by reading first element
    const b = Array.isArray(raw) ? (raw[0] || {}) : (raw || {});
    res.json(b);
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to load banner' });
  }
});

app.put('/api/banner', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { title = '', subtitle = '', imageBase64 = '' } = req.body;
    const obj = { id: 1, title, subtitle, imageBase64 };
    // Write single-object, and also maintain legacy array for compatibility
    await writeData('banners.json', obj);
    res.json({ success: true, banner: obj, message: 'Banner updated' });
  } catch (e) {
    console.error('Save banner error:', e);
    res.status(500).json({ success: false, message: 'Failed to save banner' });
  }
});

// Legacy array endpoints kept for backward-compatibility
app.get('/api/banners', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const raw = await readData('banners.json');
    const b = Array.isArray(raw) ? (raw[0] || null) : (raw || null);
    res.json(b ? [b] : []);
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to load banners' });
  }
});

app.post('/api/banners', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { title = '', subtitle = '', imageBase64 = '' } = req.body;
    const obj = { id: 1, title, subtitle, imageBase64 };
    await writeData('banners.json', obj);
    res.json({ success: true, banner: obj, message: 'Banner saved' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to save banner' });
  }
});

// QRIS: store as single object
app.get('/api/qris', isAuthenticated, async (req, res) => {
  try {
    const raw = await readData('qris.json');
    const q = Array.isArray(raw) ? (raw[0] || {}) : (raw || {});
    res.json(q);
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to load QRIS' });
  }
});

app.post('/api/qris', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { imageBase64 = '' } = req.body;
    const q = { id: 1, imageBase64 };
    await writeData('qris.json', q);
    res.json({ success: true, qris: q, message: 'QRIS updated' });
  } catch (e) {
    console.error('Save QRIS error:', e);
    res.status(500).json({ success: false, message: 'Failed to save QRIS' });
  }
});

// Also accept PUT for QRIS
app.put('/api/qris', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { imageBase64 = '' } = req.body;
    const q = { id: 1, imageBase64 };
    await writeData('qris.json', q);
    res.json({ success: true, qris: q, message: 'QRIS updated' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to save QRIS' });
  }
});

// ---- Compatibility aliases (ID-based) ----
// Some frontend code may call /api/banners/1 or /api/qris/1. Provide aliases.
app.get('/api/banners/1', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const banners = await readData('banners.json');
    const b = Array.isArray(banners) && banners.length > 0 ? banners[0] : null;
    if (!b) return res.json({});
    res.json(b);
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to load banner' });
  }
});

app.post('/api/banners/1', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { title = '', subtitle = '', imageBase64 = '' } = req.body;
    let banners = await readData('banners.json');
    if (!Array.isArray(banners)) banners = [];
    const newBanner = { id: banners[0]?.id || 1, title, subtitle, imageBase64 };
    if (banners.length === 0) banners.push(newBanner); else banners[0] = newBanner;
    await writeData('banners.json', banners);
    res.json({ success: true, banner: banners[0], message: 'Banner saved' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to save banner' });
  }
});

app.get('/api/qris/1', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const raw = await readData('qris.json');
    const q = Array.isArray(raw) ? (raw[0] || {}) : (raw || {});
    res.json(q);
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to load QRIS' });
  }
});

app.post('/api/qris/1', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { imageBase64 = '' } = req.body;
    const q = { id: 1, imageBase64 };
    await writeData('qris.json', q);
    res.json({ success: true, qris: q, message: 'QRIS updated' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to save QRIS' });
  }
});

// Users
app.get("/api/users", isAuthenticated, isAdmin, async (req, res) => {
  try {
    const users = await readData("users.json");
    // Don't send password hashes to the client
    const usersWithoutPasswords = users.map(({ password, ...user }) => user);
    res.json(usersWithoutPasswords);
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to load users" });
  }
});

app.post("/api/users", isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { username, name, password, role, status = "active" } = req.body;

    // Validasi username duplikat
    const existingUser = await validateUsername(username.trim());
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: `Username "${username}" sudah ada. Silakan gunakan username lain.`,
      });
    }

    // Hash password sebelum menyimpan
    const hashedPassword = await bcrypt.hash(password, 10);

    const users = await readData("users.json");
    const newUser = {
      id: Date.now(),
      username: username.trim(),
      name: name.trim(),
      password: hashedPassword,
      role,
      status,
      createdAt: new Date().toISOString(),
    };
    users.push(newUser);
    await writeData("users.json", users);
    res.json(newUser);
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({ success: false, message: "Failed to create user" });
  }
});

app.put("/api/users/:id", isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { username, name, password, role, status } = req.body; // Tambahkan username di sini
    const userId = req.params.id;

    // Validasi username duplikat
    const existingUser = await validateUsername(username.trim(), userId);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: `Username "${username}" sudah ada. Silakan gunakan username lain.`,
      });
    }

    const users = await readData("users.json");
    const index = users.findIndex((u) => u.id == userId);

    if (index !== -1) {
      users[index] = {
        ...users[index],
        username: username.trim(), // Tambahkan ini
        name: name.trim(),
        role,
        status,
        updatedAt: new Date().toISOString(),
      };

      // Hash password baru jika ada
      if (password) {
        users[index].password = await bcrypt.hash(password, 10);
      }

      await writeData("users.json", users);
      res.json(users[index]);
    } else {
      res.status(404).json({
        success: false,
        message: "User tidak ditemukan",
      });
    }
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update user",
    });
  }
});

app.delete("/api/users/:id", isAuthenticated, isAdmin, async (req, res) => {
  try {
    const userId = req.params.id;

    // Cegah apakah user yang sedang login
    if (req.session.user && req.session.user.id == userId) {
      return res.status(400).json({
        success: false,
        message: "Tidak dapat menghapus user yang sedang login",
      });
    }

    const users = await readData("users.json");
    const filteredUsers = users.filter((u) => u.id != userId);

    if (users.length !== filteredUsers.length) {
      await writeData("users.json", filteredUsers);
      res.json({ success: true });
    } else {
      res.status(404).json({
        success: false,
        message: "User tidak ditemukan",
      });
    }
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete user",
    });
  }
});

// PERBAIKAN: Validasi password user yang sedang login untuk aksi berbahaya
app.post(
  "/api/validate-current-user-password",
  isAuthenticated,
  async (req, res) => {
    try {
      const { password } = req.body;
      const users = await readData("users.json");
      const currentUser = users.find((u) => u.id === req.session.user.id);

      if (!currentUser) {
        return res
          .status(404)
          .json({ success: false, message: "User not found." });
      }

      const isMatch = await bcrypt.compare(password, currentUser.password);
      if (isMatch) {
        res.json({ success: true, message: "Password validated." });
      } else {
        res.status(401).json({ success: false, message: "Invalid password." });
      }
    } catch (error) {
      console.error("Error validating password:", error);
      res.status(500).json({ success: false, message: "Server error." });
    }
  }
);

// Categories
app.get("/api/categories", isAuthenticated, async (req, res) => {
  try {
    const categories = await readData("categories.json");
    res.json(categories);
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Failed to load categories" });
  }
});

app.post("/api/categories", isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { name } = req.body;

    // Validasi nama kategori
    if (!name || name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Nama kategori wajib diisi",
      });
    }

    // Cek nama kategori duplikat
    const existingCategory = await validateCategoryName(name.trim());
    if (existingCategory) {
      return res.status(400).json({
        success: false,
        message: `Kategori "${name}" sudah ada. Silakan gunakan nama lain.`,
      });
    }

    const categories = await readData("categories.json");
    const newCategory = {
      id: Date.now(),
      ...req.body,
      name: name.trim(),
    };
    categories.push(newCategory);
    await writeData("categories.json", categories);
    res.json(newCategory);
  } catch (error) {
    console.error("Error creating category:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create category",
    });
  }
});

app.put("/api/categories/:id", isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    const categoryId = req.params.id;

    // Validasi nama kategori
    if (!name || name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Nama kategori wajib diisi",
      });
    }

    // Cek nama kategori duplikat
    const existingCategory = await validateCategoryName(
      name.trim(),
      categoryId
    );
    if (existingCategory) {
      return res.status(400).json({
        success: false,
        message: `Kategori "${name}" sudah ada. Silakan gunakan nama lain.`,
      });
    }

    const categories = await readData("categories.json");
    const index = categories.findIndex((c) => c.id == categoryId);

    if (index !== -1) {
      categories[index] = {
        ...categories[index],
        ...req.body,
        name: name.trim(),
      };
      await writeData("categories.json", categories);
      res.json(categories[index]);
    } else {
      res.status(404).json({
        success: false,
        message: "Kategori tidak ditemukan",
      });
    }
  } catch (error) {
    console.error("Error updating category:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update category",
    });
  }
});

app.delete(
  "/api/categories/:id",
  isAuthenticated,
  isAdmin,
  async (req, res) => {
    try {
      const categoryId = req.params.id;

      // Cek apakah kategori sedang digunakan oleh produk
      const products = await readData("products.json"); // Gunakan readData langsung
      const productsInCategory = products.filter(
        (p) => p.categoryId == categoryId
      );

      if (productsInCategory.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Tidak dapat menghapus kategori ini karena masih digunakan oleh ${productsInCategory.length} produk. Pindahkan atau hapus produk tersebut terlebih dahulu.`,
        });
      }

      const categories = await readData("categories.json");
      const filteredCategories = categories.filter((c) => c.id != categoryId);

      if (categories.length !== filteredCategories.length) {
        await writeData("categories.json", filteredCategories);
        res.json({ success: true });
      } else {
        res.status(404).json({
          success: false,
          message: "Kategori tidak ditemukan",
        });
      }
    } catch (error) {
      console.error("Error deleting category:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete category",
      });
    }
  }
);

// Products
app.get("/api/products", isAuthenticated, async (req, res) => {
  try {
    const products = await readData("products.json");
    res.json(products);
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Failed to load products" });
  }
});

app.post("/api/products", isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { name } = req.body;

    // Validasi nama produk
    if (!name || name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Nama produk wajib diisi",
      });
    }

    // Cek nama produk duplikat
    const existingProduct = await validateProductName(name.trim());
    if (existingProduct) {
      return res.status(400).json({
        success: false,
        message: `Produk "${name}" sudah ada. Silakan gunakan nama lain.`,
      });
    }

    const products = await readData("products.json");
    const purchasePrice = Number(req.body.purchasePrice || 0) || 0;
    const sellingPrice =
      req.body.sellingPrice !== undefined
        ? Number(req.body.sellingPrice) || 0
        : Number(req.body.price || 0) || 0;
    const qrCode = req.body.qrCode || "";

    const newProduct = {
      id: Date.now(),
      sku: `PROD-${Date.now()}`,
      ...req.body,
      name: name.trim(),
      purchasePrice,
      sellingPrice,
      qrCode,
      // Backward compatibility for POS which uses product.price
      price: sellingPrice,
    };
    products.push(newProduct);
    await writeData("products.json", products);
    res.json(newProduct);
  } catch (error) {
    console.error("Error creating product:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create product",
    });
  }
});

app.put("/api/products/:id", isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    const productId = req.params.id;

    // Validasi nama produk
    if (!name || name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Nama produk wajib diisi",
      });
    }

    // Cek nama produk duplikat
    const existingProduct = await validateProductName(name.trim(), productId);
    if (existingProduct) {
      return res.status(400).json({
        success: false,
        message: `Produk "${name}" sudah ada. Silakan gunakan nama lain.`,
      });
    }

    const products = await readData("products.json");
    const index = products.findIndex((p) => p.id == productId);

    if (index !== -1) {
      const purchasePrice =
        req.body.purchasePrice !== undefined
          ? Number(req.body.purchasePrice) || 0
          : products[index].purchasePrice || 0;
      const sellingPrice =
        req.body.sellingPrice !== undefined
          ? Number(req.body.sellingPrice) || 0
          : (products[index].sellingPrice != null
              ? products[index].sellingPrice
              : products[index].price || 0);
      const qrCode = req.body.qrCode !== undefined ? req.body.qrCode : (products[index].qrCode || "");

      products[index] = {
        ...products[index],
        ...req.body,
        name: name.trim(),
        purchasePrice,
        sellingPrice,
        qrCode,
        price: sellingPrice,
      };
      await writeData("products.json", products);
      res.json(products[index]);
    } else {
      res.status(404).json({
        success: false,
        message: "Produk tidak ditemukan",
      });
    }
  } catch (error) {
    console.error("Error updating product:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update product",
    });
  }
});

app.delete("/api/products/:id", isAuthenticated, isAdmin, async (req, res) => {
  try {
    const productId = req.params.id;

    // Cek apakah produk sedang digunakan oleh transaksi
    const transactions = await readData("transactions.json");
    const usedProducts = transactions.flatMap((t) =>
      t.items.map((item) => item.productId)
    );

    if (usedProducts.includes(productId)) {
      return res.status(400).json({
        success: false,
        message: `Produk ini sedang digunakan dalam transaksi. Tidak dapat dihapus.`,
      });
    }

    const products = await readData("products.json");
    const filteredProducts = products.filter((p) => p.id != productId);

    if (products.length !== filteredProducts.length) {
      // Perbaikan logika
      await writeData("products.json", filteredProducts);
      res.json({ success: true });
    } else {
      res.status(404).json({
        success: false,
        message: "Produk tidak ditemukan",
      });
    }
  } catch (error) {
    console.error("Error deleting product:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete product",
    });
  }
});

// Transactions
app.get("/api/transactions", isAuthenticated, isAdmin, async (req, res) => {
  try {
    const transactions = await readData("transactions.json");
    res.json(transactions);
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Failed to load transactions" });
  }
});

app.post("/api/transactions", isAuthenticated, async (req, res) => {
  try {
    const { items, paymentMethod, amountReceived } = req.body;
    if (!items || items.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Cart cannot be empty." });
    }

    const products = await readData("products.json");
    const transactions = await readData("transactions.json");
    let totalAmount = 0;
    const transactionItems = items.map((item) => {
      const product = products.find((p) => p.id === item.productId);
      if (!product)
        throw new Error(`Product with ID ${item.productId} not found`);
      if (product.stock < item.qty)
        throw new Error(`Insufficient stock for ${product.name}`);
      product.stock -= item.qty;
      totalAmount += product.price * item.qty;
      return {
        productId: product.id,
        name: product.name,
        price: product.price,
        qty: item.qty,
        subtotal: product.price * item.qty,
      };
    });

    const newTransaction = {
      id: `TRX-${new Date()
        .toISOString()
        .slice(0, 10)
        .replace(/-/g, "")}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      userId: req.session.user.id,
      items: transactionItems,
      totalAmount,
      paymentMethod,
      amountReceived: paymentMethod === "cash" ? amountReceived : totalAmount,
      change: paymentMethod === "cash" ? amountReceived - totalAmount : 0,
    };

    transactions.push(newTransaction);
    await writeData("transactions.json", transactions);
    await writeData("products.json", products);
    res.json(newTransaction);
  } catch (error) {
    console.error("Transaction error:", error);
    res
      .status(400)
      .json({
        success: false,
        message: error.message || "Failed to create transaction",
      });
  }
});

app.get("/api/recent-transactions", isAuthenticated, async (req, res) => {
  try {
    const transactions = await readData("transactions.json");
    const recentTransactions = transactions
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 5);
    res.json(recentTransactions);
  } catch (error) {
    console.error("Failed to fetch recent transactions:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "Failed to fetch recent transactions.",
      });
  }
});

app.delete("/api/transactions/:id", isAuthenticated, async (req, res) => {
  try {
    const transactions = await readData("transactions.json");
    const products = await readData("products.json");
    const transactionIndex = transactions.findIndex(
      (t) => t.id === req.params.id
    );

    if (transactionIndex === -1) {
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found." });
    }

    const transactionToVoid = transactions[transactionIndex];

    // Kembalikan stok produk
    for (const item of transactionToVoid.items) {
      const product = products.find((p) => p.id === item.productId);
      if (product) {
        product.stock += item.qty;
      }
    }

    // Hapus transaksi
    transactions.splice(transactionIndex, 1);

    await writeData("products.json", products);
    await writeData("transactions.json", transactions);

    res.json({ success: true, message: "Transaction voided successfully." });
  } catch (error) {
    console.error("Failed to void transaction:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to void transaction." });
  }
});

// --- Excel Import/Export API Routes ---
// --- API untuk Validasi Admin ---
app.post("/api/admin/validate-password", async (req, res) => {
  try {
    const { password } = req.body;

    // Di production, gunakan bcrypt untuk hash password
    // Untuk demo ini, kita bandingkan dengan password admin hardcoded
    const ADMIN_PASSWORD = "admin123"; // Ganti dengan password admin Anda yang sebenarnya

    const isValid = password === ADMIN_PASSWORD;

    res.json({ valid: isValid });
  } catch (error) {
    console.error("Error validating admin password:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Restore produk dari backup
app.post(
  "/api/products/restore",
  isAuthenticated,
  isAdmin,
  async (req, res) => {
    try {
      // Validasi password admin secara langsung, bukan dengan fetch
      const { password } = req.body;
      const ADMIN_PASSWORD = "admin123"; // Sama dengan di API validasi

      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({
          success: false,
          message: "Invalid admin password",
        });
      }

      // Cari file backup terbaru
      const backupDir = path.join(DATA_DIR, "backup");
      let backupFiles = [];

      try {
        const files = await fs.readdir(backupDir);
        backupFiles = files.filter(
          (file) => file.startsWith("products_") && file.endsWith(".json")
        );
        backupFiles.sort((a, b) => {
          const aTime = a.split("_")[1].replace(".json", "");
          const bTime = b.split("_")[1].replace(".json", "");
          return bTime.localeCompare(aTime);
        });
      } catch (error) {
        console.error("Error reading backup directory:", error);
      }

      if (backupFiles.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Tidak ada backup produk yang ditemukan",
        });
      }

      // Baca file backup terbaru
      const latestBackup = await readData(`backup/${backupFiles[0]}`);

      // Restore produk
      await writeData("products.json", latestBackup);

      res.json({
        success: true,
        message: `Produk berhasil dipulihkan dari backup: ${backupFiles[0]}`,
      });
    } catch (error) {
      console.error("Error restoring products:", error);
      res.status(500).json({
        success: false,
        message: "Failed to restore products",
      });
    }
  }
);

// --- Excel Import/Export API Routes ---

// Export Products to XLSX
app.get("/api/products/export", isAuthenticated, isAdmin, async (req, res) => {
  try {
    console.log("Requesting export...");
    const products = await readData("products.json");
    const categories = await readData("categories.json");

    // Transform data for export - EXCLUDE Image Base64 to avoid cell limit
    const exportData = products.map((product) => {
      const category = categories.find((c) => c.id === product.categoryId);
      return {
        "Product Name": product.name || "",
        "Purchase Price": product.purchasePrice || 0,
        "Selling Price": (product.sellingPrice != null ? product.sellingPrice : product.price) || 0,
        Price: product.price || 0,
        Stock: product.stock || 0,
        Category: category ? category.name : "",
        SKU: product.sku || "",
        "QR Code": product.qrCode || "",
        "Is Top Product": product.isTopProduct ? "Yes" : "No",
        "Is Best Seller": product.isBestSeller ? "Yes" : "No",
        "Has Image": product.imageBase64 ? "Yes" : "No",
      };
    });

    // Create workbook
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Products");

    // Set column widths
    const colWidths = [
      { wch: 30 }, // Product Name
      { wch: 15 }, // Purchase Price
      { wch: 15 }, // Selling Price
      { wch: 15 }, // Price (legacy)
      { wch: 10 }, // Stock
      { wch: 20 }, // Category
      { wch: 20 }, // SKU
      { wch: 25 }, // QR Code
      { wch: 15 }, // Is Top Product
      { wch: 15 }, // Is Best Seller
      { wch: 15 }, // Has Image
    ];
    ws["!cols"] = colWidths;

    // Generate buffer
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    // Set headers
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=products_export.xlsx"
    );

    console.log("Export completed successfully");
    res.send(buf);
  } catch (error) {
    console.error("Export error:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "Failed to export products: " + error.message,
      });
  }
});

// Download Import Template
app.get(
  "/api/products/template",
  isAuthenticated,
  isAdmin,
  async (req, res) => {
    try {
      console.log("Requesting template...");
      const categories = await readData("categories.json");

      // Create template data with example rows - include new price fields and QR Code
      const templateData = [
        {
          "Product Name": "Example Product 1",
          "Purchase Price": 8000,
          "Selling Price": 10000,
          Price: 10000,
          Stock: 50,
          Category: categories.length > 0 ? categories[0].name : "General",
          SKU: "PROD-001",
          "QR Code": "QR-EX-001",
          "Is Top Product": "Yes",
          "Is Best Seller": "No",
          "Has Image": "No",
        },
        {
          "Product Name": "Example Product 2",
          "Purchase Price": 20000,
          "Selling Price": 25000,
          Price: 25000,
          Stock: 30,
          Category: categories.length > 1 ? categories[1].name : "General",
          SKU: "PROD-002",
          "QR Code": "QR-EX-002",
          "Is Top Product": "No",
          "Is Best Seller": "Yes",
          "Has Image": "No",
        },
      ];

      // Create workbook
      const ws = XLSX.utils.json_to_sheet(templateData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Template");

      // Set column widths
      const colWidths = [
        { wch: 30 }, // Product Name
        { wch: 15 }, // Purchase Price
        { wch: 15 }, // Selling Price
        { wch: 15 }, // Price (legacy)
        { wch: 10 }, // Stock
        { wch: 20 }, // Category
        { wch: 20 }, // SKU
        { wch: 25 }, // QR Code
        { wch: 15 }, // Is Top Product
        { wch: 15 }, // Is Best Seller
        { wch: 15 }, // Has Image
      ];
      ws["!cols"] = colWidths;

      // Generate buffer
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

      // Set headers
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=product_import_template.xlsx"
      );

      console.log("Template generated successfully");
      res.send(buf);
    } catch (error) {
      console.error("Template generation error:", error);
      res
        .status(500)
        .json({
          success: false,
          message: "Failed to generate template: " + error.message,
        });
    }
  }
);

// Import Products from XLSX
app.post("/api/products/import", isAuthenticated, isAdmin, async (req, res) => {
  try {
    console.log("Starting import...");
    const { products: importData } = req.body;

    if (!Array.isArray(importData) || importData.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No valid data to import" });
    }

    console.log("Import data received:", importData.length, "rows");
    console.log("First row sample:", importData[0]);

    const products = await readData("products.json");
    const categories = await readData("categories.json");

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (let i = 0; i < importData.length; i++) {
      try {
        const row = importData[i];
        console.log(`Processing row ${i + 1}:`, row);

        // Validate required fields: Product Name, Stock, and (Selling Price or Price)
        const hasName = !!row["Product Name"];
        const hasStock = row["Stock"] !== undefined && row["Stock"] !== "";
        const hasSellingPrice = row["Selling Price"] !== undefined && row["Selling Price"] !== "";
        const hasLegacyPrice = row["Price"] !== undefined && row["Price"] !== "";
        if (!hasName || !hasStock || (!hasSellingPrice && !hasLegacyPrice)) {
          const errorMsg = `Baris ${i + 1}: Kolom wajib tidak lengkap. Wajib: Product Name, Stock, dan Selling Price atau Price.`;
          errors.push(errorMsg);
          errorCount++;
          continue;
        }

        // Find category
        let categoryId = null;
        if (
          row["Category"] &&
          row["Category"] &&
          row["Category"].toString().trim() !== ""
        ) {
          const category = categories.find(
            (c) =>
              c.name &&
              c.name.toLowerCase() === row["Category"].toString().trim()
          );
          if (category) {
            categoryId = category.id;
          } else {
            // Create new category if not exists
            const newCategory = {
              id: Date.now() + i,
              name: row["Category"].toString().trim(),
              description: `Dibuat otomatis dari import`,
            };
            categories.push(newCategory);
            categoryId = newCategory.id;
            console.log(`Created new category: ${newCategory.name}`);
          }
        }

        // Create product object with new fields
        const purchasePrice = parseFloat(row["Purchase Price"]) || 0;
        const sellingPrice = row["Selling Price"] !== undefined && row["Selling Price"] !== ""
          ? (parseFloat(row["Selling Price"]) || 0)
          : (parseFloat(row["Price"]) || 0);
        const qrCode = (row["QR Code"] || "").toString().trim();

        const newProduct = {
          id: Date.now() + i,
          name: row["Product Name"].toString().trim(),
          stock: parseInt(row["Stock"]) || 0,
          categoryId: categoryId,
          sku: row["SKU"]
            ? row["SKU"].toString().trim()
            : `PROD-${Date.now()}-${i}`,
          purchasePrice,
          sellingPrice,
          qrCode,
          // Backward compat for POS
          price: sellingPrice,
          isTopProduct:
            row["Is Top Product"] &&
            row["Is Top Product"].toString().toLowerCase() === "yes",
          isBestSeller:
            row["Is Best Seller"] &&
            row["Is Best Seller"].toString().toLowerCase() === "yes",
          imageBase64: "", // Always empty for imports
        };

        products.push(newProduct);
        successCount++;
        console.log(`Successfully added product: ${newProduct.name}`);
      } catch (error) {
        const errorMsg = `Baris ${i + 1}: ${error.message}`;
        errors.push(errorMsg);
        errorCount++;
      }
    }

    // Save data
    await writeData("products.json", products);
    await writeData("categories.json", categories);

    // Send response
    let message = `Import selesai. Sukses: ${successCount}, Error: ${errorCount}`;
    if (errors.length > 0) {
      message += `\n\nBeberapa error pertama:\n${errors
        .slice(0, 3)
        .join("\n")}`;
      if (errors.length > 5) {
        message += ` ... dan ${errors.length - 5} more errors`;
      }
    }

    console.log("Import completed:", message);
    res.json({
      success: true,
      message,
      successCount,
      errorCount,
      errors: errors.slice(0, 10), // Return first 10 errors
    });
  } catch (error) {
    console.error("!!! IMPORT ERROR !!!", error);
    res.status(500).json({
      success: false,
      message: "Failed to import products: " + error.message,
    });
  }
});

// Check username availability
app.post("/api/users/check-username/:id?", async (req, res) => {
  try {
    const { username } = req.body;
    const userId = req.params.id;

    const existingUser = await validateUsername(username.trim(), userId);
    res.json({ exists: !!existingUser });
  } catch (error) {
    console.error("Error checking username:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Check product name availability
app.post("/api/products/check-name/:id?", async (req, res) => {
  try {
    const { name } = req.body;
    const productId = req.params.id;

    const existingProduct = await validateProductName(name.trim(), productId);
    res.json({ exists: !!existingProduct });
  } catch (error) {
    console.error("Error checking product name:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Check category name availability
app.post("/api/categories/check-name/:id?", async (req, res) => {
  try {
    const { name } = req.body;
    const categoryId = req.params.id;

    const existingCategory = await validateCategoryName(
      name.trim(),
      categoryId
    );
    res.json({ exists: !!existingCategory });
  } catch (error) {
    console.error("Error checking category name:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Reset user password
app.post(
  "/api/users/:id/reset-password",
  isAuthenticated,
  isAdmin,
  async (req, res) => {
    try {
      const { newPassword } = req.body;
      const userId = req.params.id;

      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message: "Password minimal 6 karakter",
        });
      }

      const users = await readData("users.json");
      const index = users.findIndex((u) => u.id == userId);

      if (index !== -1) {
        users[index].password = await bcrypt.hash(newPassword, 10);
        users[index].updatedAt = new Date().toISOString();

        await writeData("users.json", users);
        res.json({
          success: true,
          message: "Password berhasil direset",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "User tidak ditemukan",
        });
      }
    } catch (error) {
      console.error("Error resetting password:", error);
      res.status(500).json({
        success: false,
        message: "Failed to reset password",
      });
    }
  }
);

// --- Product Drafts API ---
// Helper untuk draf POS
const readPosDrafts = async () => readData("pos-drafts.json");
const writePosDrafts = async (drafts) => writeData("pos-drafts.json", drafts);

// GET /api/drafts - Ambil semua draf
app.get("/api/drafts", isAuthenticated, async (req, res) => {
  try {
    const drafts = await readPosDrafts();
    res.json(drafts);
  } catch (error) {
    console.error("Error loading drafts:", error);
    res.status(500).json({ success: false, message: "Failed to load drafts" });
  }
});

// POST /api/drafts - Simpan draf baru
app.post("/api/drafts", isAuthenticated, async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || items.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Cannot save an empty draft." });
    }

    const drafts = await readPosDrafts();
    const newDraft = {
      id: Date.now().toString(),
      items: items,
      timestamp: new Date().toISOString(),
    };
    drafts.push(newDraft);
    await writePosDrafts(drafts);
    res.json({
      success: true,
      message: "Draft saved successfully!",
      draft: newDraft,
    });
  } catch (error) {
    console.error("Error saving draft:", error);
    res.status(500).json({ success: false, message: "Failed to save draft" });
  }
});

// PUT /api/drafts/:id/load - Muat draf ke keranjang dan hapus
app.put("/api/drafts/:id/load", isAuthenticated, async (req, res) => {
  try {
    const drafts = await readPosDrafts();
    const draftIndex = drafts.findIndex((d) => d.id === req.params.id);

    if (draftIndex === -1) {
      return res
        .status(404)
        .json({ success: false, message: "Draft not found." });
    }

    const draftToLoad = drafts[draftIndex];

    // Hapus draf setelah dimuat
    drafts.splice(draftIndex, 1);
    await writePosDrafts(drafts);

    res.json({
      success: true,
      message: "Draft loaded successfully.",
      items: draftToLoad.items,
    });
  } catch (error) {
    console.error("Error loading draft:", error);
    res.status(500).json({ success: false, message: "Failed to load draft" });
  }
});

// DELETE /api/drafts/:id - Hapus draf
app.delete("/api/drafts/:id", isAuthenticated, async (req, res) => {
  try {
    const drafts = await readPosDrafts();
    const filteredDrafts = drafts.filter((d) => d.id !== req.params.id);

    if (drafts.length === filteredDrafts.length) {
      return res
        .status(404)
        .json({ success: false, message: "Draft not found." });
    }

    await writePosDrafts(filteredDrafts);
    res.json({ success: true, message: "Draft deleted successfully." });
  } catch (error) {
    console.error("Error deleting draft:", error);
    res.status(500).json({ success: false, message: "Failed to delete draft" });
  }
});

// --- PERUBAHAN 3: Inisialisasi Server yang Lebih Aman ---
// Gunakan async IIFE untuk memastikan direktori data ada sebelum server berjalan
(async () => {
  try {
    await ensureDataDir();
    const server = app.listen(PORT, HOST, () => {
      console.log(`Server berjalan di http://${HOST}:${PORT}`);
    });
    server.on("error", (err) => {
      console.error("Server error saat start:", err);
      process.exit(1);
    });
  } catch (err) {
    console.error("Startup error:", err);
    process.exit(1);
  }
})();
