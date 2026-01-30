const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();

// ============================================
// КОНФИГУРАЦИЯ
// ============================================
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const FRONTEND_URL = process.env.FRONTEND_URL || '*';
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').filter(Boolean).map(Number);
const INITIAL_BALANCE = parseInt(process.env.INITIAL_BALANCE) || 100;

// Призы рулетки (21 слот)
const PRIZES = [
  { id: 0, image: '🧸', name: 'bear', value: '0.6x', multiplier: 0.6, chance: 12 },
  { id: 1, image: '🧸', name: 'bear', value: '0.6x', multiplier: 0.6, chance: 12 },
  { id: 2, image: '🌹', name: 'rose', value: '1x', multiplier: 1, chance: 10 },
  { id: 3, image: '⚡', name: 'boost', value: 'Boost', multiplier: 0, isBoost: true, chance: 8 },
  { id: 4, image: '❤️', name: 'heart', value: '0.6x', multiplier: 0.6, chance: 12 },
  { id: 5, image: '💐', name: 'flowers', value: '2x', multiplier: 2, chance: 6 },
  { id: 6, image: '💎', name: 'diamond', value: '4x', multiplier: 4, chance: 2 },
  { id: 7, image: '🎁', name: 'gift', value: '1x', multiplier: 1, chance: 10 },
  { id: 8, image: '🚀', name: 'rocket', value: '2x', multiplier: 2, chance: 6 },
  { id: 9, image: '🧸', name: 'bear', value: '0.6x', multiplier: 0.6, chance: 12 },
  { id: 10, image: '❤️', name: 'heart', value: '0.6x', multiplier: 0.6, chance: 12 },
  { id: 11, image: '💍', name: 'ring', value: '4x', multiplier: 4, chance: 2 },
  { id: 12, image: '🌹', name: 'rose', value: '1x', multiplier: 1, chance: 10 },
  { id: 13, image: '⚡', name: 'boost', value: 'Boost', multiplier: 0, isBoost: true, chance: 8 },
  { id: 14, image: '🏆', name: 'trophy', value: '4x', multiplier: 4, chance: 2 },
  { id: 15, image: '🧸', name: 'bear', value: '0.6x', multiplier: 0.6, chance: 12 },
  { id: 16, image: '🌹', name: 'rose', value: '1x', multiplier: 1, chance: 10 },
  { id: 17, image: '💐', name: 'flowers', value: '2x', multiplier: 2, chance: 6 },
  { id: 18, image: '🎁', name: 'gift', value: '1x', multiplier: 1, chance: 10 },
  { id: 19, image: '🐍', name: 'snake', value: '20x', multiplier: 20, chance: 0.3 },
  { id: 20, image: '🌹', name: 'rose', value: '1x', multiplier: 1, chance: 10 },
];

const VALID_BETS = [25, 50, 100, 250];
const DEPOSIT_OPTIONS = [
  { amount: 100, bonus: 0 },
  { amount: 250, bonus: 10 },
  { amount: 500, bonus: 15 },
  { amount: 1000, bonus: 20 },
];

// ============================================
// DATABASE (sql.js - чистый JS, работает везде)
// ============================================
let db = null;
const DB_PATH = process.env.DATABASE_PATH || './data/roulette.db';

async function initDatabase() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  
  // Создаём папку для БД
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  // Загружаем существующую БД или создаём новую
  try {
    if (fs.existsSync(DB_PATH)) {
      const buffer = fs.readFileSync(DB_PATH);
      db = new SQL.Database(buffer);
      console.log('📂 Database loaded from disk');
    } else {
      db = new SQL.Database();
      console.log('📂 New database created');
    }
  } catch (err) {
    console.error('Database load error:', err);
    db = new SQL.Database();
  }

  // Создаём таблицы
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      photo_url TEXT,
      balance INTEGER DEFAULT ${INITIAL_BALANCE},
      total_deposited INTEGER DEFAULT 0,
      total_wagered INTEGER DEFAULT 0,
      total_won INTEGER DEFAULT 0,
      total_spins INTEGER DEFAULT 0,
      has_boost INTEGER DEFAULT 0,
      is_banned INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_active TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS spins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      bet INTEGER NOT NULL,
      prize_id INTEGER NOT NULL,
      win_amount INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      boost_used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      stars_amount INTEGER,
      bonus_amount INTEGER DEFAULT 0,
      telegram_payment_id TEXT,
      status TEXT DEFAULT 'pending',
      payload TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_spins_user ON spins(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id)`);

  saveDatabase();
  console.log('✅ Database initialized');
}

function saveDatabase() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (err) {
    console.error('Database save error:', err);
  }
}

// Автосохранение каждые 30 секунд
setInterval(saveDatabase, 30000);

// ============================================
// DATABASE HELPERS
// ============================================
function dbGet(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function dbAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function dbRun(sql, params = []) {
  db.run(sql, params);
}

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors({
  origin: FRONTEND_URL === '*' ? true : FRONTEND_URL.split(','),
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-Telegram-Init-Data']
}));
app.use(express.json());

// Логирование
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

// ============================================
// UTILS
// ============================================
function validateInitData(initData) {
  if (!initData) return { valid: false };
  
  // Демо режим без токена - принимаем любые данные
  if (!BOT_TOKEN) {
    try {
      const params = new URLSearchParams(initData);
      const userStr = params.get('user');
      if (userStr) {
        return { valid: true, user: JSON.parse(userStr), demo: true };
      }
    } catch (e) {
      // Если не удалось распарсить - создаём демо юзера
      console.log('Demo mode: creating mock user');
    }
    // В демо режиме без BOT_TOKEN всегда пропускаем
    return { 
      valid: true, 
      user: { id: 123456789, username: 'demo_user', first_name: 'Demo' }, 
      demo: true 
    };
  }

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');

    // Проверка времени (24 часа)
    const authDate = parseInt(params.get('auth_date') || '0');
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > 86400) {
      return { valid: false, error: 'Auth data expired' };
    }

    // Формируем строку для проверки
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    // Вычисляем хеш
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (calculatedHash !== hash) {
      return { valid: false, error: 'Invalid hash' };
    }

    const userStr = params.get('user');
    return { valid: true, user: userStr ? JSON.parse(userStr) : null };
  } catch (e) {
    console.error('InitData validation error:', e);
    return { valid: false, error: e.message };
  }
}

function authMiddleware(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];
  
  console.log('🔐 Auth middleware:', {
    hasInitData: !!initData,
    initDataLength: initData?.length || 0,
    hasBotToken: !!BOT_TOKEN,
  });
  
  const { valid, user, demo, error } = validateInitData(initData);
  
  console.log('🔐 Validation result:', { valid, userId: user?.id, demo, error });
  
  if (!valid) {
    console.log('❌ Auth failed:', error);
    return res.status(401).json({ error: error || 'Unauthorized' });
  }
  
  req.telegramUser = user;
  req.isDemo = demo;
  next();
}

function adminMiddleware(req, res, next) {
  if (!ADMIN_IDS.includes(req.telegramUser?.id)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

function getOrCreateUser(tgUser) {
  if (!tgUser) return null;
  
  let user = dbGet('SELECT * FROM users WHERE id = ?', [tgUser.id]);
  
  if (!user) {
    dbRun(
      'INSERT INTO users (id, username, first_name, last_name, photo_url, balance) VALUES (?, ?, ?, ?, ?, ?)',
      [tgUser.id, tgUser.username || null, tgUser.first_name || null, tgUser.last_name || null, tgUser.photo_url || null, INITIAL_BALANCE]
    );
    user = dbGet('SELECT * FROM users WHERE id = ?', [tgUser.id]);
    console.log(`👤 New user: ${tgUser.id} (@${tgUser.username})`);
    saveDatabase();
  } else {
    dbRun(
      'UPDATE users SET username = ?, first_name = ?, last_name = ?, photo_url = ?, last_active = CURRENT_TIMESTAMP WHERE id = ?',
      [tgUser.username || user.username, tgUser.first_name || user.first_name, tgUser.last_name || user.last_name, tgUser.photo_url || user.photo_url, tgUser.id]
    );
  }
  
  return dbGet('SELECT * FROM users WHERE id = ?', [tgUser.id]);
}

function getRandomPrizeIndex() {
  const total = PRIZES.reduce((sum, p) => sum + p.chance, 0);
  let random = Math.random() * total;
  
  for (let i = 0; i < PRIZES.length; i++) {
    random -= PRIZES[i].chance;
    if (random <= 0) return i;
  }
  return 0;
}

async function telegramAPI(method, body) {
  if (!BOT_TOKEN) {
    throw new Error('BOT_TOKEN not configured');
  }
  
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  const data = await response.json();
  
  if (!data.ok) {
    throw new Error(data.description || 'Telegram API error');
  }
  
  return data.result;
}

// ============================================
// API ROUTES
// ============================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    botConfigured: !!BOT_TOKEN,
    dbReady: !!db,
    timestamp: new Date().toISOString()
  });
});

// Авторизация
app.post('/api/auth', (req, res) => {
  try {
    const { initData } = req.body;
    const { valid, user: tgUser, demo } = validateInitData(initData);
    
    // Если нет валидных данных - создаём демо юзера
    const mockUser = tgUser || {
      id: 123456789,
      username: 'demo_user',
      first_name: 'Demo',
      last_name: 'User'
    };
    
    const user = getOrCreateUser(mockUser);
    
    if (user && user.is_banned) {
      return res.status(403).json({ error: 'User is banned' });
    }

    res.json({
      success: true,
      demo: demo || !tgUser,
      user: {
        id: user.id,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        photo_url: user.photo_url,
        balance: user.balance,
        has_boost: !!user.has_boost,
        total_spins: user.total_spins,
        total_won: user.total_won,
      }
    });
  } catch (e) {
    console.error('Auth error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Получить баланс
app.get('/api/balance', authMiddleware, (req, res) => {
  try {
    const user = getOrCreateUser(req.telegramUser);
    res.json({
      success: true,
      balance: user.balance,
      hasBoost: !!user.has_boost
    });
  } catch (e) {
    console.error('Balance error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Крутить рулетку
app.post('/api/spin', authMiddleware, (req, res) => {
  try {
    const { bet } = req.body;
    const user = getOrCreateUser(req.telegramUser);

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (user.is_banned) {
      return res.status(403).json({ error: 'User is banned' });
    }

    if (!VALID_BETS.includes(bet)) {
      return res.status(400).json({ error: 'Invalid bet amount' });
    }

    if (user.balance < bet) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Генерируем результат
    const targetSlot = getRandomPrizeIndex();
    const prize = PRIZES[targetSlot];

    let winAmount = 0;
    let newHasBoost = user.has_boost;
    const boostUsed = user.has_boost && !prize.isBoost;

    if (prize.isBoost) {
      // Получили буст
      newHasBoost = 1;
    } else if (prize.multiplier > 0) {
      winAmount = Math.floor(bet * prize.multiplier);
      if (boostUsed) {
        winAmount *= 2;
        newHasBoost = 0;
      }
    }

    const newBalance = user.balance - bet + winAmount;

    // Обновляем пользователя
    dbRun(
      'UPDATE users SET balance = ?, total_wagered = total_wagered + ?, total_won = total_won + ?, total_spins = total_spins + 1, has_boost = ?, last_active = CURRENT_TIMESTAMP WHERE id = ?',
      [newBalance, bet, winAmount, newHasBoost, user.id]
    );

    // Записываем спин
    dbRun(
      'INSERT INTO spins (user_id, bet, prize_id, win_amount, balance_after, boost_used) VALUES (?, ?, ?, ?, ?, ?)',
      [user.id, bet, targetSlot, winAmount, newBalance, boostUsed ? 1 : 0]
    );

    saveDatabase();

    console.log(`🎰 User ${user.id}: bet ${bet}⭐ → ${prize.image} ${prize.value} → won ${winAmount}⭐`);

    res.json({
      success: true,
      targetSlot,
      prize: {
        id: prize.id,
        image: prize.image,
        name: prize.name,
        value: prize.value,
        multiplier: prize.multiplier,
        isBoost: !!prize.isBoost
      },
      bet,
      winAmount,
      boostUsed,
      newBalance,
      hasBoost: !!newHasBoost,
    });
  } catch (e) {
    console.error('Spin error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// История спинов
app.get('/api/history', authMiddleware, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const user = getOrCreateUser(req.telegramUser);
    
    const spins = dbAll(
      'SELECT * FROM spins WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
      [user.id, limit]
    );
    
    res.json({
      success: true,
      history: spins.map(s => ({
        id: s.id,
        bet: s.bet,
        prize: PRIZES[s.prize_id],
        winAmount: s.win_amount,
        boostUsed: !!s.boost_used,
        createdAt: s.created_at,
      }))
    });
  } catch (e) {
    console.error('History error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Start server
initDatabase().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
