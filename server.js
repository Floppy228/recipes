const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const multer = require('multer');
const nodemailer = require('nodemailer');
const mysql = require('mysql2/promise');
const { nanoid } = require('nanoid');

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const RESET_CODE_TTL_MS = 15 * 60 * 1000;

const CATEGORY_LIST = [
  'Завтраки',
  'Супы',
  'Салаты',
  'Паста',
  'Пицца',
  'Мясо',
  'Рыба',
  'Десерты',
  'Выпечка',
  'Напитки',
  'Вегетарианские',
  'Быстрые блюда'
];

const db = mysql.createPool({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'recipes_app',
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  queueLimit: 0,
  charset: 'utf8mb4'
});

function toIso(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return new Date(value).toISOString();
}

function normalizeForSearch(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function withoutPassword(user) {
  if (!user) return null;
  return {
    id: user.id,
    login: user.login,
    email: user.email,
    createdAt: toIso(user.created_at)
  };
}

function authRequired(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  next();
}

function parseJsonField(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function buildMailer() {
  const user = String(process.env.GMAIL_USER || '').trim();
  const pass = String(process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '').trim();
  if (!user || !pass) return null;

  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass }
  });
}

async function initDb() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(32) PRIMARY KEY,
      login VARCHAR(100) NOT NULL UNIQUE,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS recipes (
      id VARCHAR(32) PRIMARY KEY,
      author_id VARCHAR(32) NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      category VARCHAR(100) NOT NULL,
      cover_image TEXT NOT NULL,
      views INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      CONSTRAINT fk_recipes_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS recipe_ingredients (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      recipe_id VARCHAR(32) NOT NULL,
      position_index INT NOT NULL,
      value_text TEXT NOT NULL,
      CONSTRAINT fk_ing_recipe FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
      INDEX idx_ing_recipe (recipe_id, position_index)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS recipe_steps (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      recipe_id VARCHAR(32) NOT NULL,
      position_index INT NOT NULL,
      text_value TEXT NOT NULL,
      image_url TEXT NOT NULL,
      CONSTRAINT fk_steps_recipe FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
      INDEX idx_steps_recipe (recipe_id, position_index)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS recipe_likes (
      recipe_id VARCHAR(32) NOT NULL,
      user_id VARCHAR(32) NOT NULL,
      PRIMARY KEY (recipe_id, user_id),
      CONSTRAINT fk_likes_recipe FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
      CONSTRAINT fk_likes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS recipe_comments (
      id VARCHAR(32) PRIMARY KEY,
      recipe_id VARCHAR(32) NOT NULL,
      user_id VARCHAR(32) NOT NULL,
      user_login VARCHAR(100) NOT NULL,
      text_value TEXT NOT NULL,
      created_at DATETIME NOT NULL,
      CONSTRAINT fk_comments_recipe FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
      CONSTRAINT fk_comments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_comments_recipe (recipe_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS reset_codes (
      id VARCHAR(32) PRIMARY KEY,
      user_id VARCHAR(32) NOT NULL,
      email VARCHAR(255) NOT NULL,
      code VARCHAR(12) NOT NULL,
      created_at DATETIME NOT NULL,
      used TINYINT(1) NOT NULL DEFAULT 0,
      CONSTRAINT fk_reset_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_reset_user_created (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function getUserById(userId) {
  const [rows] = await db.query('SELECT id, login, email, created_at FROM users WHERE id = ? LIMIT 1', [userId]);
  return rows[0] || null;
}

async function getRecipeById(recipeId, sessionUserId) {
  const [rows] = await db.query(
    `
    SELECT
      r.id,
      r.author_id,
      u.login AS author_login,
      r.title,
      r.description,
      r.category,
      r.cover_image,
      r.views,
      r.created_at,
      r.updated_at,
      (SELECT COUNT(*) FROM recipe_likes rl WHERE rl.recipe_id = r.id) AS likes_count,
      (SELECT COUNT(*) FROM recipe_comments rc WHERE rc.recipe_id = r.id) AS comments_count,
      EXISTS(
        SELECT 1 FROM recipe_likes rl2 WHERE rl2.recipe_id = r.id AND rl2.user_id = ?
      ) AS user_liked
    FROM recipes r
    JOIN users u ON u.id = r.author_id
    WHERE r.id = ?
    LIMIT 1
    `,
    [sessionUserId || '', recipeId]
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  const [ingredientsRows] = await db.query(
    'SELECT value_text FROM recipe_ingredients WHERE recipe_id = ? ORDER BY position_index ASC',
    [recipeId]
  );

  const [stepsRows] = await db.query(
    'SELECT text_value, image_url FROM recipe_steps WHERE recipe_id = ? ORDER BY position_index ASC',
    [recipeId]
  );

  const [commentsRows] = await db.query(
    `
    SELECT id, user_id, user_login, text_value, created_at
    FROM recipe_comments
    WHERE recipe_id = ?
    ORDER BY created_at DESC
    `,
    [recipeId]
  );

  return {
    id: row.id,
    authorId: row.author_id,
    authorLogin: row.author_login,
    title: row.title,
    description: row.description,
    category: row.category,
    ingredients: ingredientsRows.map((r) => r.value_text),
    steps: stepsRows.map((r) => ({ text: r.text_value, image: r.image_url || '' })),
    likes: [],
    comments: commentsRows.map((c) => ({
      id: c.id,
      userId: c.user_id,
      userLogin: c.user_login,
      text: c.text_value,
      createdAt: toIso(c.created_at)
    })),
    views: Number(row.views || 0),
    coverImage: row.cover_image || '',
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    likesCount: Number(row.likes_count || 0),
    commentsCount: Number(row.comments_count || 0),
    userLiked: Boolean(row.user_liked)
  };
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change_this_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'public', 'uploads'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${nanoid(8)}${ext}`);
  }
});

const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Разрешены только изображения'));
    }
    cb(null, true);
  }
});

app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));
app.use('/pages', express.static(path.join(__dirname, 'public', 'pages')));

app.get('/', (req, res) => {
  res.redirect('/pages/index.html');
});

app.get('/favicon.svg', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'favicon.svg'));
});

app.get('/favicon.ico', (req, res) => {
  res.redirect('/favicon.svg');
});

app.get('/api/categories', (req, res) => {
  res.json({ categories: CATEGORY_LIST });
});

app.get('/api/session', async (req, res, next) => {
  try {
    if (!req.session.userId) {
      return res.json({ user: null });
    }
    const user = await getUserById(req.session.userId);
    res.json({ user: withoutPassword(user) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const { login, email, password } = req.body;
    if (!login || !email || !password) {
      return res.status(400).json({ error: 'Заполните все поля' });
    }

    const normalizedLogin = String(login).trim();
    const normalizedEmail = String(email).trim().toLowerCase();

    const [loginRows] = await db.query('SELECT id FROM users WHERE LOWER(login) = LOWER(?) LIMIT 1', [normalizedLogin]);
    if (loginRows.length) {
      return res.status(409).json({ error: 'Логин уже занят' });
    }

    const [emailRows] = await db.query('SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1', [normalizedEmail]);
    if (emailRows.length) {
      return res.status(409).json({ error: 'Email уже используется' });
    }

    const userId = nanoid(12);
    const passwordHash = await bcrypt.hash(password, 10);

    await db.query(
      'INSERT INTO users (id, login, email, password_hash, created_at) VALUES (?, ?, ?, ?, NOW())',
      [userId, normalizedLogin, normalizedEmail, passwordHash]
    );

    req.session.userId = userId;
    const user = await getUserById(userId);
    res.status(201).json({ user: withoutPassword(user) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { login, password } = req.body;
    if (!login || !password) {
      return res.status(400).json({ error: 'Введите логин и пароль' });
    }

    const [rows] = await db.query(
      'SELECT id, login, email, password_hash, created_at FROM users WHERE LOWER(login) = LOWER(?) LIMIT 1',
      [String(login).trim()]
    );

    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    req.session.userId = user.id;
    res.json({ user: withoutPassword(user) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.delete('/api/auth/account', authRequired, async (req, res, next) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query('SELECT id FROM users WHERE id = ? LIMIT 1', [req.session.userId]);
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    await connection.query('DELETE FROM users WHERE id = ?', [req.session.userId]);
    await connection.commit();

    req.session.destroy(() => {
      res.json({ ok: true });
    });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.post('/api/auth/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Введите email' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const [users] = await db.query('SELECT id, email FROM users WHERE LOWER(email) = ? LIMIT 1', [normalizedEmail]);
    const user = users[0];

    if (!user) {
      return res.json({ ok: true, message: 'Если email существует, код отправлен' });
    }

    await db.query('DELETE FROM reset_codes WHERE created_at < (NOW() - INTERVAL 15 MINUTE)');

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await db.query(
      'INSERT INTO reset_codes (id, user_id, email, code, created_at, used) VALUES (?, ?, ?, ?, NOW(), 0)',
      [nanoid(10), user.id, user.email, code]
    );

    const mailer = buildMailer();
    if (!mailer) {
      return res.status(500).json({
        error: 'Почтовый сервис не настроен. Добавьте GMAIL_USER и GMAIL_APP_PASSWORD в переменные окружения.'
      });
    }

    await mailer.sendMail({
      from: process.env.GMAIL_USER,
      to: user.email,
      subject: 'Код восстановления пароля',
      text: `Ваш код подтверждения: ${code}. Код действителен 15 минут.`
    });

    res.json({ ok: true, message: 'Код отправлен на email' });
  } catch (error) {
    console.error('Mail send error:', error && error.message ? error.message : error);
    res.status(500).json({ error: 'Не удалось отправить письмо. Проверьте Gmail App Password.' });
  }
});

app.post('/api/auth/reset-password', async (req, res, next) => {
  const connection = await db.getConnection();
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: 'Заполните все поля' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const [users] = await connection.query('SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1', [normalizedEmail]);
    const user = users[0];
    if (!user) {
      return res.status(400).json({ error: 'Некорректные данные' });
    }

    const [codes] = await connection.query(
      `
      SELECT id, code, created_at
      FROM reset_codes
      WHERE user_id = ? AND used = 0
      ORDER BY created_at DESC
      `,
      [user.id]
    );

    const now = Date.now();
    const validCode = codes.find((entry) => {
      const age = now - new Date(entry.created_at).getTime();
      return age <= RESET_CODE_TTL_MS && entry.code === String(code).trim();
    });

    if (!validCode) {
      return res.status(400).json({ error: 'Код недействителен или истёк' });
    }

    await connection.beginTransaction();
    const passwordHash = await bcrypt.hash(String(newPassword), 10);
    await connection.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, user.id]);
    await connection.query('UPDATE reset_codes SET used = 1 WHERE id = ?', [validCode.id]);
    await connection.commit();

    res.json({ ok: true, message: 'Пароль успешно изменён' });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.get('/api/recipes', async (req, res, next) => {
  try {
    const { category, search, mine, author, sort, liked } = req.query;
    const conditions = [];
    const params = [];

    if (mine === '1' && req.session.userId) {
      conditions.push('r.author_id = ?');
      params.push(req.session.userId);
    }

    if (liked === '1') {
      if (!req.session.userId) {
        return res.json({ recipes: [] });
      }
      conditions.push('EXISTS (SELECT 1 FROM recipe_likes rl_filter WHERE rl_filter.recipe_id = r.id AND rl_filter.user_id = ?)');
      params.push(req.session.userId);
    }

    if (category && category !== 'Все') {
      conditions.push('r.category = ?');
      params.push(category);
    }

    const textSearch = String(search || author || '').trim();
    if (textSearch) {
      const q = `%${textSearch.toLowerCase()}%`;
      const normalized = `%${normalizeForSearch(textSearch)}%`;
      conditions.push(`(
        LOWER(r.title) LIKE ? OR
        LOWER(r.description) LIKE ? OR
        EXISTS (SELECT 1 FROM recipe_ingredients ri WHERE ri.recipe_id = r.id AND LOWER(ri.value_text) LIKE ?) OR
        LOWER(u.login) LIKE ? OR
        REPLACE(REPLACE(REPLACE(LOWER(u.login), ' ', ''), '-', ''), '_', '') LIKE ?
      )`);
      params.push(q, q, q, q, normalized);
    }

    const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderSql = sort === 'likes'
      ? 'ORDER BY likes_count DESC, r.views DESC'
      : 'ORDER BY r.updated_at DESC';

    const [rows] = await db.query(
      `
      SELECT
        r.id,
        r.author_id,
        u.login AS author_login,
        r.title,
        r.description,
        r.category,
        r.cover_image,
        r.views,
        r.created_at,
        r.updated_at,
        (SELECT COUNT(*) FROM recipe_likes rl WHERE rl.recipe_id = r.id) AS likes_count,
        (SELECT COUNT(*) FROM recipe_comments rc WHERE rc.recipe_id = r.id) AS comments_count,
        EXISTS(
          SELECT 1 FROM recipe_likes rl2
          WHERE rl2.recipe_id = r.id AND rl2.user_id = ?
        ) AS user_liked
      FROM recipes r
      JOIN users u ON u.id = r.author_id
      ${whereSql}
      ${orderSql}
      `,
      [req.session.userId || '', ...params]
    );

    res.json({
      recipes: rows.map((row) => ({
        id: row.id,
        authorId: row.author_id,
        authorLogin: row.author_login,
        title: row.title,
        description: row.description,
        category: row.category,
        ingredients: [],
        steps: [],
        likes: [],
        comments: [],
        views: Number(row.views || 0),
        coverImage: row.cover_image || '',
        createdAt: toIso(row.created_at),
        updatedAt: toIso(row.updated_at),
        likesCount: Number(row.likes_count || 0),
        commentsCount: Number(row.comments_count || 0),
        userLiked: Boolean(row.user_liked)
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/recipes/:id', async (req, res, next) => {
  try {
    const recipe = await getRecipeById(req.params.id, req.session.userId);
    if (!recipe) {
      return res.status(404).json({ error: 'Рецепт не найден' });
    }
    res.json({ recipe });
  } catch (error) {
    next(error);
  }
});

app.post('/api/recipes/:id/view', async (req, res, next) => {
  try {
    const [result] = await db.query('UPDATE recipes SET views = views + 1 WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Рецепт не найден' });
    }

    const [rows] = await db.query('SELECT views FROM recipes WHERE id = ? LIMIT 1', [req.params.id]);
    res.json({ ok: true, views: Number(rows[0].views || 0) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/recipes/:id/like', authRequired, async (req, res, next) => {
  try {
    const recipeId = req.params.id;
    const userId = req.session.userId;

    const [recipes] = await db.query('SELECT id FROM recipes WHERE id = ? LIMIT 1', [recipeId]);
    if (!recipes.length) {
      return res.status(404).json({ error: 'Рецепт не найден' });
    }

    const [existing] = await db.query(
      'SELECT recipe_id FROM recipe_likes WHERE recipe_id = ? AND user_id = ? LIMIT 1',
      [recipeId, userId]
    );

    let userLiked;
    if (existing.length) {
      await db.query('DELETE FROM recipe_likes WHERE recipe_id = ? AND user_id = ?', [recipeId, userId]);
      userLiked = false;
    } else {
      await db.query('INSERT INTO recipe_likes (recipe_id, user_id) VALUES (?, ?)', [recipeId, userId]);
      userLiked = true;
    }

    const [countRows] = await db.query('SELECT COUNT(*) AS c FROM recipe_likes WHERE recipe_id = ?', [recipeId]);

    res.json({
      ok: true,
      userLiked,
      likesCount: Number(countRows[0].c || 0)
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/recipes/:id/comments', authRequired, async (req, res, next) => {
  try {
    const text = String(req.body.text || '').trim();
    if (!text) {
      return res.status(400).json({ error: 'Введите текст комментария' });
    }

    const [recipes] = await db.query('SELECT id FROM recipes WHERE id = ? LIMIT 1', [req.params.id]);
    if (!recipes.length) {
      return res.status(404).json({ error: 'Рецепт не найден' });
    }

    const currentUser = await getUserById(req.session.userId);
    if (!currentUser) {
      return res.status(401).json({ error: 'Пользователь не найден' });
    }

    const commentId = nanoid(10);
    await db.query(
      'INSERT INTO recipe_comments (id, recipe_id, user_id, user_login, text_value, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [commentId, req.params.id, currentUser.id, currentUser.login, text]
    );

    const [rows] = await db.query('SELECT COUNT(*) AS c FROM recipe_comments WHERE recipe_id = ?', [req.params.id]);

    res.status(201).json({
      comment: {
        id: commentId,
        userId: currentUser.id,
        userLogin: currentUser.login,
        text,
        createdAt: new Date().toISOString()
      },
      commentsCount: Number(rows[0].c || 0)
    });
  } catch (error) {
    next(error);
  }
});

app.post(
  '/api/recipes',
  authRequired,
  upload.fields([
    { name: 'coverImage', maxCount: 1 },
    { name: 'stepImages', maxCount: 30 }
  ]),
  async (req, res, next) => {
    const connection = await db.getConnection();
    try {
      const currentUser = await getUserById(req.session.userId);
      if (!currentUser) {
        return res.status(401).json({ error: 'Пользователь не найден' });
      }

      const body = req.body;
      const steps = parseJsonField(body.steps, []);
      const ingredients = parseJsonField(body.ingredients, []);

      const uploadedStepImages = req.files?.stepImages || [];
      const uploadedCover = req.files?.coverImage?.[0];

      const mergedSteps = steps.map((step, index) => ({
        text: String(step.text || '').trim(),
        image: uploadedStepImages[index] ? `/uploads/${uploadedStepImages[index].filename}` : ''
      })).filter((step) => step.text.length > 0);

      const normalizedIngredients = Array.isArray(ingredients)
        ? ingredients.map((item) => String(item || '').trim()).filter(Boolean)
        : [];

      const title = String(body.title || '').trim();
      const description = String(body.description || '').trim();
      const category = CATEGORY_LIST.includes(body.category) ? body.category : CATEGORY_LIST[0];

      if (!title || normalizedIngredients.length === 0 || mergedSteps.length === 0) {
        return res.status(400).json({ error: 'Заполните название, ингредиенты и шаги' });
      }

      const recipeId = nanoid(12);

      await connection.beginTransaction();
      await connection.query(
        `
        INSERT INTO recipes (id, author_id, title, description, category, cover_image, views, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, NOW(), NOW())
        `,
        [recipeId, currentUser.id, title, description, category, uploadedCover ? `/uploads/${uploadedCover.filename}` : '']
      );

      for (let i = 0; i < normalizedIngredients.length; i += 1) {
        await connection.query(
          'INSERT INTO recipe_ingredients (recipe_id, position_index, value_text) VALUES (?, ?, ?)',
          [recipeId, i, normalizedIngredients[i]]
        );
      }

      for (let i = 0; i < mergedSteps.length; i += 1) {
        await connection.query(
          'INSERT INTO recipe_steps (recipe_id, position_index, text_value, image_url) VALUES (?, ?, ?, ?)',
          [recipeId, i, mergedSteps[i].text, mergedSteps[i].image]
        );
      }

      await connection.commit();

      const recipe = await getRecipeById(recipeId, req.session.userId);
      res.status(201).json({ recipe });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }
);

app.put(
  '/api/recipes/:id',
  authRequired,
  upload.fields([
    { name: 'coverImage', maxCount: 1 },
    { name: 'stepImages', maxCount: 30 }
  ]),
  async (req, res, next) => {
    const connection = await db.getConnection();
    try {
      const [existingRows] = await connection.query('SELECT * FROM recipes WHERE id = ? LIMIT 1', [req.params.id]);
      const existingRecipe = existingRows[0];

      if (!existingRecipe) {
        return res.status(404).json({ error: 'Рецепт не найден' });
      }

      if (existingRecipe.author_id !== req.session.userId) {
        return res.status(403).json({ error: 'Нет прав на редактирование' });
      }

      const body = req.body;
      const steps = parseJsonField(body.steps, []);
      const ingredients = parseJsonField(body.ingredients, []);
      const existingStepImages = parseJsonField(body.existingStepImages, []);

      const uploadedStepImages = req.files?.stepImages || [];
      const uploadedCover = req.files?.coverImage?.[0];

      const mergedSteps = steps.map((step, index) => ({
        text: String(step.text || '').trim(),
        image: uploadedStepImages[index]
          ? `/uploads/${uploadedStepImages[index].filename}`
          : String(existingStepImages[index] || '')
      })).filter((step) => step.text.length > 0);

      const normalizedIngredients = Array.isArray(ingredients)
        ? ingredients.map((item) => String(item || '').trim()).filter(Boolean)
        : [];

      const title = String(body.title || '').trim();
      const description = String(body.description || '').trim();
      const category = CATEGORY_LIST.includes(body.category) ? body.category : CATEGORY_LIST[0];
      const coverImage = uploadedCover ? `/uploads/${uploadedCover.filename}` : (existingRecipe.cover_image || '');

      if (!title || normalizedIngredients.length === 0 || mergedSteps.length === 0) {
        return res.status(400).json({ error: 'Заполните название, ингредиенты и шаги' });
      }

      await connection.beginTransaction();

      await connection.query(
        'UPDATE recipes SET title = ?, description = ?, category = ?, cover_image = ?, updated_at = NOW() WHERE id = ?',
        [title, description, category, coverImage, req.params.id]
      );

      await connection.query('DELETE FROM recipe_ingredients WHERE recipe_id = ?', [req.params.id]);
      await connection.query('DELETE FROM recipe_steps WHERE recipe_id = ?', [req.params.id]);

      for (let i = 0; i < normalizedIngredients.length; i += 1) {
        await connection.query(
          'INSERT INTO recipe_ingredients (recipe_id, position_index, value_text) VALUES (?, ?, ?)',
          [req.params.id, i, normalizedIngredients[i]]
        );
      }

      for (let i = 0; i < mergedSteps.length; i += 1) {
        await connection.query(
          'INSERT INTO recipe_steps (recipe_id, position_index, text_value, image_url) VALUES (?, ?, ?, ?)',
          [req.params.id, i, mergedSteps[i].text, mergedSteps[i].image]
        );
      }

      await connection.commit();

      const recipe = await getRecipeById(req.params.id, req.session.userId);
      res.json({ recipe });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }
);

app.delete('/api/recipes/:id', authRequired, async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT author_id FROM recipes WHERE id = ? LIMIT 1', [req.params.id]);
    const recipe = rows[0];

    if (!recipe) {
      return res.status(404).json({ error: 'Рецепт не найден' });
    }

    if (recipe.author_id !== req.session.userId) {
      return res.status(403).json({ error: 'Нет прав на удаление' });
    }

    await db.query('DELETE FROM recipes WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: `Ошибка загрузки: ${error.message}` });
  }

  if (error) {
    return res.status(400).json({ error: error.message || 'Ошибка сервера' });
  }

  next();
});

(async () => {
  try {
    await initDb();
    app.listen(PORT, () => {
      console.log(`Server started on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('DB init error:', error && error.message ? error.message : error);
    process.exit(1);
  }
})();
