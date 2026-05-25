const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const multer = require('multer');
const nodemailer = require('nodemailer');
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
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const USERS_PATH = path.join(DATA_DIR, 'users.json');
const RECIPES_PATH = path.join(DATA_DIR, 'recipes.json');
const RESET_CODES_PATH = path.join(DATA_DIR, 'resetCodes.json');

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

function safeReadArray(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function writeArray(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function withoutPassword(user) {
  if (!user) return null;
  return {
    id: user.id,
    login: user.login,
    email: user.email,
    createdAt: user.createdAt
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

function normalizeForSearch(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function normalizeRecipe(recipe) {
  const steps = Array.isArray(recipe.steps)
    ? recipe.steps
        .map((step) => ({
          text: String(step.text || '').trim(),
          image: step.image || ''
        }))
        .filter((step) => step.text.length > 0)
    : [];

  const comments = Array.isArray(recipe.comments)
    ? recipe.comments
        .map((comment) => ({
          id: comment.id || nanoid(10),
          userId: comment.userId || '',
          userLogin: String(comment.userLogin || '').trim(),
          text: String(comment.text || '').trim(),
          createdAt: comment.createdAt || new Date().toISOString()
        }))
        .filter((comment) => comment.userId && comment.userLogin && comment.text)
    : [];

  const likes = Array.isArray(recipe.likes)
    ? recipe.likes
        .map((userId) => String(userId || '').trim())
        .filter(Boolean)
    : [];

  const views = Number.isFinite(Number(recipe.views)) ? Number(recipe.views) : 0;

  return {
    id: recipe.id,
    authorId: recipe.authorId,
    authorLogin: recipe.authorLogin,
    title: String(recipe.title || '').trim(),
    description: String(recipe.description || '').trim(),
    category: CATEGORY_LIST.includes(recipe.category) ? recipe.category : CATEGORY_LIST[0],
    ingredients: Array.isArray(recipe.ingredients)
      ? recipe.ingredients.map((item) => String(item).trim()).filter(Boolean)
      : [],
    steps,
    likes,
    comments,
    views,
    coverImage: recipe.coverImage || '',
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt
  };
}

function buildMailer() {
  const user = String(process.env.GMAIL_USER || '').trim();
  const pass = String(process.env.GMAIL_APP_PASSWORD || '')
    .replace(/\s+/g, '')
    .trim();
  if (!user || !pass) return null;

  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass }
  });
}

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

app.get('/api/session', (req, res) => {
  const users = safeReadArray(USERS_PATH);
  const currentUser = users.find((user) => user.id === req.session.userId);
  res.json({ user: withoutPassword(currentUser) });
});

app.post('/api/auth/register', async (req, res) => {
  const { login, email, password } = req.body;
  if (!login || !email || !password) {
    return res.status(400).json({ error: 'Заполните все поля' });
  }

  const users = safeReadArray(USERS_PATH);
  const normalizedLogin = String(login).trim();
  const normalizedEmail = String(email).trim().toLowerCase();

  if (users.some((u) => u.login.toLowerCase() === normalizedLogin.toLowerCase())) {
    return res.status(409).json({ error: 'Логин уже занят' });
  }

  if (users.some((u) => u.email.toLowerCase() === normalizedEmail)) {
    return res.status(409).json({ error: 'Email уже используется' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: nanoid(12),
    login: normalizedLogin,
    email: normalizedEmail,
    passwordHash,
    createdAt: new Date().toISOString()
  };

  users.push(user);
  writeArray(USERS_PATH, users);

  req.session.userId = user.id;
  res.status(201).json({ user: withoutPassword(user) });
});

app.post('/api/auth/login', async (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) {
    return res.status(400).json({ error: 'Введите логин и пароль' });
  }

  const users = safeReadArray(USERS_PATH);
  const user = users.find((u) => u.login.toLowerCase() === String(login).trim().toLowerCase());

  if (!user) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  req.session.userId = user.id;
  res.json({ user: withoutPassword(user) });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Введите email' });
  }

  const users = safeReadArray(USERS_PATH);
  const user = users.find((u) => u.email.toLowerCase() === String(email).trim().toLowerCase());

  if (!user) {
    return res.json({ ok: true, message: 'Если email существует, код отправлен' });
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const resetCodes = safeReadArray(RESET_CODES_PATH).filter(
    (entry) => Date.now() - new Date(entry.createdAt).getTime() < 15 * 60 * 1000
  );

  resetCodes.push({
    id: nanoid(10),
    userId: user.id,
    email: user.email,
    code,
    createdAt: new Date().toISOString(),
    used: false
  });
  writeArray(RESET_CODES_PATH, resetCodes);

  const mailer = buildMailer();
  if (!mailer) {
    return res.status(500).json({
      error: 'Почтовый сервис не настроен. Добавьте GMAIL_USER и GMAIL_APP_PASSWORD в переменные окружения.'
    });
  }

  try {
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

app.post('/api/auth/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) {
    return res.status(400).json({ error: 'Заполните все поля' });
  }

  const users = safeReadArray(USERS_PATH);
  const user = users.find((u) => u.email.toLowerCase() === String(email).trim().toLowerCase());
  if (!user) {
    return res.status(400).json({ error: 'Некорректные данные' });
  }

  const resetCodes = safeReadArray(RESET_CODES_PATH);
  const validCode = resetCodes
    .filter((entry) => !entry.used && entry.userId === user.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .find((entry) => Date.now() - new Date(entry.createdAt).getTime() <= 15 * 60 * 1000 && entry.code === String(code).trim());

  if (!validCode) {
    return res.status(400).json({ error: 'Код недействителен или истёк' });
  }

  user.passwordHash = await bcrypt.hash(String(newPassword), 10);
  const updatedUsers = users.map((item) => (item.id === user.id ? user : item));
  writeArray(USERS_PATH, updatedUsers);

  const updatedCodes = resetCodes.map((entry) =>
    entry.id === validCode.id ? { ...entry, used: true } : entry
  );
  writeArray(RESET_CODES_PATH, updatedCodes);

  res.json({ ok: true, message: 'Пароль успешно изменён' });
});

app.get('/api/recipes', (req, res) => {
  const { category, search, mine, author, sort, liked } = req.query;
  const recipes = safeReadArray(RECIPES_PATH).map(normalizeRecipe);

  let result = recipes;

  if (mine === '1' && req.session.userId) {
    result = result.filter((recipe) => recipe.authorId === req.session.userId);
  }

  if (liked === '1') {
    if (!req.session.userId) {
      return res.json({ recipes: [] });
    }

    result = result.filter((recipe) => recipe.likes.includes(req.session.userId));
  }

  if (category && category !== 'Все') {
    result = result.filter((recipe) => recipe.category === category);
  }

  const textSearch = String(search || author || '').trim();
  if (textSearch) {
    const q = textSearch.toLowerCase();
    const qNormalized = normalizeForSearch(textSearch);
    result = result.filter(
      (recipe) =>
        recipe.title.toLowerCase().includes(q) ||
        recipe.description.toLowerCase().includes(q) ||
        recipe.ingredients.some((ing) => ing.toLowerCase().includes(q)) ||
        recipe.authorLogin.toLowerCase().includes(q) ||
        normalizeForSearch(recipe.authorLogin).includes(qNormalized)
    );
  }

  if (sort === 'likes') {
    result = result.sort((a, b) => {
      if (b.likes.length !== a.likes.length) {
        return b.likes.length - a.likes.length;
      }
      return b.views - a.views;
    });
  } else {
    result = result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  res.json({
    recipes: result.map((recipe) => ({
      ...recipe,
      likesCount: recipe.likes.length,
      commentsCount: recipe.comments.length,
      userLiked: req.session.userId ? recipe.likes.includes(req.session.userId) : false
    }))
  });
});

app.get('/api/recipes/:id', (req, res) => {
  const recipes = safeReadArray(RECIPES_PATH).map(normalizeRecipe);
  const recipe = recipes.find((r) => r.id === req.params.id);
  if (!recipe) {
    return res.status(404).json({ error: 'Рецепт не найден' });
  }
  res.json({
    recipe: {
      ...recipe,
      likesCount: recipe.likes.length,
      commentsCount: recipe.comments.length,
      userLiked: req.session.userId ? recipe.likes.includes(req.session.userId) : false
    }
  });
});

app.post('/api/recipes/:id/view', (req, res) => {
  const recipes = safeReadArray(RECIPES_PATH).map(normalizeRecipe);
  const idx = recipes.findIndex((recipe) => recipe.id === req.params.id);

  if (idx === -1) {
    return res.status(404).json({ error: 'Рецепт не найден' });
  }

  recipes[idx].views += 1;
  recipes[idx].updatedAt = recipes[idx].updatedAt || new Date().toISOString();
  writeArray(RECIPES_PATH, recipes);

  res.json({ ok: true, views: recipes[idx].views });
});

app.post('/api/recipes/:id/like', authRequired, (req, res) => {
  const recipes = safeReadArray(RECIPES_PATH).map(normalizeRecipe);
  const idx = recipes.findIndex((recipe) => recipe.id === req.params.id);

  if (idx === -1) {
    return res.status(404).json({ error: 'Рецепт не найден' });
  }

  const recipe = recipes[idx];
  const likeIndex = recipe.likes.indexOf(req.session.userId);

  if (likeIndex >= 0) {
    recipe.likes.splice(likeIndex, 1);
  } else {
    recipe.likes.push(req.session.userId);
  }

  writeArray(RECIPES_PATH, recipes);

  res.json({
    ok: true,
    userLiked: recipe.likes.includes(req.session.userId),
    likesCount: recipe.likes.length
  });
});

app.post('/api/recipes/:id/comments', authRequired, (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) {
    return res.status(400).json({ error: 'Введите текст комментария' });
  }

  const recipes = safeReadArray(RECIPES_PATH).map(normalizeRecipe);
  const idx = recipes.findIndex((recipe) => recipe.id === req.params.id);

  if (idx === -1) {
    return res.status(404).json({ error: 'Рецепт не найден' });
  }

  const users = safeReadArray(USERS_PATH);
  const currentUser = users.find((user) => user.id === req.session.userId);

  if (!currentUser) {
    return res.status(401).json({ error: 'Пользователь не найден' });
  }

  const comment = {
    id: nanoid(10),
    userId: currentUser.id,
    userLogin: currentUser.login,
    text,
    createdAt: new Date().toISOString()
  };

  recipes[idx].comments.unshift(comment);
  writeArray(RECIPES_PATH, recipes);

  res.status(201).json({ comment, commentsCount: recipes[idx].comments.length });
});

app.post(
  '/api/recipes',
  authRequired,
  upload.fields([
    { name: 'coverImage', maxCount: 1 },
    { name: 'stepImages', maxCount: 30 }
  ]),
  (req, res) => {
    const users = safeReadArray(USERS_PATH);
    const currentUser = users.find((u) => u.id === req.session.userId);
    if (!currentUser) {
      return res.status(401).json({ error: 'Пользователь не найден' });
    }

    const body = req.body;
    const steps = parseJsonField(body.steps, []);
    const ingredients = parseJsonField(body.ingredients, []);

    const uploadedStepImages = req.files?.stepImages || [];
    const uploadedCover = req.files?.coverImage?.[0];

    const mergedSteps = steps.map((step, index) => ({
      text: step.text || '',
      image: uploadedStepImages[index] ? `/uploads/${uploadedStepImages[index].filename}` : ''
    }));

    const recipe = normalizeRecipe({
      id: nanoid(12),
      authorId: currentUser.id,
      authorLogin: currentUser.login,
      title: body.title,
      description: body.description,
      category: body.category,
      ingredients,
      steps: mergedSteps,
      coverImage: uploadedCover ? `/uploads/${uploadedCover.filename}` : '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    if (!recipe.title || recipe.ingredients.length === 0 || recipe.steps.length === 0) {
      return res.status(400).json({ error: 'Заполните название, ингредиенты и шаги' });
    }

    const recipes = safeReadArray(RECIPES_PATH);
    recipes.push(recipe);
    writeArray(RECIPES_PATH, recipes);

    res.status(201).json({ recipe });
  }
);

app.put(
  '/api/recipes/:id',
  authRequired,
  upload.fields([
    { name: 'coverImage', maxCount: 1 },
    { name: 'stepImages', maxCount: 30 }
  ]),
  (req, res) => {
    const recipes = safeReadArray(RECIPES_PATH);
    const idx = recipes.findIndex((r) => r.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Рецепт не найден' });
    }

    const existingRecipe = recipes[idx];
    if (existingRecipe.authorId !== req.session.userId) {
      return res.status(403).json({ error: 'Нет прав на редактирование' });
    }

    const body = req.body;
    const steps = parseJsonField(body.steps, []);
    const ingredients = parseJsonField(body.ingredients, []);
    const existingStepImages = parseJsonField(body.existingStepImages, []);

    const uploadedStepImages = req.files?.stepImages || [];
    const uploadedCover = req.files?.coverImage?.[0];

    const mergedSteps = steps.map((step, index) => ({
      text: step.text || '',
      image: uploadedStepImages[index]
        ? `/uploads/${uploadedStepImages[index].filename}`
        : existingStepImages[index] || ''
    }));

    const recipe = normalizeRecipe({
      ...existingRecipe,
      title: body.title,
      description: body.description,
      category: body.category,
      ingredients,
      steps: mergedSteps,
      coverImage: uploadedCover ? `/uploads/${uploadedCover.filename}` : existingRecipe.coverImage,
      updatedAt: new Date().toISOString()
    });

    if (!recipe.title || recipe.ingredients.length === 0 || recipe.steps.length === 0) {
      return res.status(400).json({ error: 'Заполните название, ингредиенты и шаги' });
    }

    recipes[idx] = recipe;
    writeArray(RECIPES_PATH, recipes);

    res.json({ recipe });
  }
);

app.delete('/api/recipes/:id', authRequired, (req, res) => {
  const recipes = safeReadArray(RECIPES_PATH);
  const recipe = recipes.find((r) => r.id === req.params.id);

  if (!recipe) {
    return res.status(404).json({ error: 'Рецепт не найден' });
  }

  if (recipe.authorId !== req.session.userId) {
    return res.status(403).json({ error: 'Нет прав на удаление' });
  }

  const filtered = recipes.filter((r) => r.id !== req.params.id);
  writeArray(RECIPES_PATH, filtered);

  res.json({ ok: true });
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

app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});
