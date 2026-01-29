const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();

// ============================================
// КОНФИГУРАЦИЯ
// ============================================
const BOT_TOKEN = process.env.BOT_TOKEN;
const FRONTEND_URL = process.env.FRONTEND_URL || '*';
const ADMIN_IDS = process.env.ADMIN_IDS?.split(',').map(Number) || [];
const INITIAL_BALANCE = parseInt(process.env.INITIAL_BALANCE) || 100;

// Призы рулетки
const PRIZES = [
  { id: 0, image: '🧸', name: 'bear', value: '0.6x', multiplier: 0.6, chance: 12 },
  { id: 1, image: '🧸', name: 'bear', value: '0.6x', multiplier: 0.6, chance: 12 },
  { id: 2, image: '🌹', name: 'rose', value: '1x', multiplier: 1, chance: 10 },
  { id: 3, image: '🚀', name: 'boost', value: 'Boost', multiplier: 0, isBoost: true, chance: 8 },
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
// DATABASE
// ============================================
const dbPath = process.env.DATABASE_PATH || './data/roulette.db';
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

db.exec(`
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
  );

  CREATE TABLE IF NOT EXISTS spins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    bet INTEGER NOT NULL,
    prize_id INTEGER NOT NULL,
    win_amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    boost_used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

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
  );

  CREATE INDEX IF NOT EXISTS idx_spins_user ON spins(user_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
`);

// Prepared statements
const stmt = {
  getUser: db.prepare('SELECT * FROM users WHERE id = ?'),
  createUser: db.prepare('INSERT INTO users (id, username, first_name, last_name, photo_url, balance) VALUES (?, ?, ?, ?, ?, ?)'),
  updateUser: db.prepare('UPDATE users SET username = ?, first_name = ?, last_name = ?, photo_url = ?, last_active = CURRENT_TIMESTAMP WHERE id = ?'),
  updateUserStats: db.prepare('UPDATE users SET balance = ?, total_wagered = total_wagered + ?, total_won = total_won + ?, total_spins = total_spins + 1, has_boost = ?, last_active = CURRENT_TIMESTAMP WHERE id = ?'),
  addDeposit: db.prepare('UPDATE users SET balance = balance + ?, total_deposited = total_deposited + ? WHERE id = ?'),
  createSpin: db.prepare('INSERT INTO spins (user_id, bet, prize_id, win_amount, balance_after, boost_used) VALUES (?, ?, ?, ?, ?, ?)'),
  getUserSpins: db.prepare('SELECT * FROM spins WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'),
  createTransaction: db.prepare('INSERT INTO transactions (user_id, type, amount, stars_amount, bonus_amount, payload, status) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  updateTransaction: db.prepare('UPDATE transactions SET status = ?, telegram_payment_id = ? WHERE id = ?'),
  getPendingTransaction: db.prepare("SELECT * FROM transactions WHERE payload = ? AND status = 'pending' LIMIT 1"),
  getStats: db.prepare('SELECT COUNT(DISTINCT id) as users, SUM(total_wagered) as wagered, SUM(total_won) as won FROM users'),
  banUser: db.prepare('UPDATE users SET is_banned = 1 WHERE id = ?'),
  unbanUser: db.prepare('UPDATE users SET is_banned = 0 WHERE id = ?'),
  setBalance: db.prepare('UPDATE users SET balance = ? WHERE id = ?'),
};

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors({
  origin: FRONTEND_URL === '*' ? true : FRONTEND_URL.split(','),
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-Telegram-Init-Data']
}));
app.use(express.json());

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`));
  next();
});

// ============================================
// UTILS
// ============================================
function validateInitData(initData) {
  if (!initData) return { valid: false };
  if (!BOT_TOKEN) {
    try {
      const params = new URLSearchParams(initData);
      const userStr = params.get('user');
      if (userStr) return { valid: true, user: JSON.parse(userStr), demo: true };
    } catch {}
    return { valid: false };
  }

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');

    const authDate = parseInt(params.get('auth_date') || '0');
    if (Math.floor(Date.now() / 1000) - authDate > 86400) return { valid: false };

    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (calculatedHash !== hash) return { valid: false };

    const userStr = params.get('user');
    return { valid: true, user: userStr ? JSON.parse(userStr) : null };
  } catch {
    return { valid: false };
  }
}

function authMiddleware(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];
  const { valid, user, demo } = validateInitData(initData);
  if (!valid) return res.status(401).json({ error: 'Unauthorized' });
  req.telegramUser = user;
  req.isDemo = demo;
  next();
}

function adminMiddleware(req, res, next) {
  if (!ADMIN_IDS.includes(req.telegramUser?.id)) return res.status(403).json({ error: 'Forbidden' });
  next();
}

function getOrCreateUser(tgUser) {
  let user = stmt.getUser.get(tgUser.id);
  if (!user) {
    stmt.createUser.run(tgUser.id, tgUser.username, tgUser.first_name, tgUser.last_name, tgUser.photo_url, INITIAL_BALANCE);
    user = stmt.getUser.get(tgUser.id);
    console.log(`👤 New user: ${tgUser.id} (@${tgUser.username})`);
  } else {
    stmt.updateUser.run(tgUser.username || user.username, tgUser.first_name || user.first_name, tgUser.last_name || user.last_name, tgUser.photo_url || user.photo_url, tgUser.id);
  }
  return stmt.getUser.get(tgUser.id);
}

function getRandomPrizeIndex() {
  const total = PRIZES.reduce((s, p) => s + p.chance, 0);
  let r = Math.random() * total;
  for (let i = 0; i < PRIZES.length; i++) {
    r -= PRIZES[i].chance;
    if (r <= 0) return i;
  }
  return 0;
}

async function telegramAPI(method, body) {
  if (!BOT_TOKEN) throw new Error('BOT_TOKEN not configured');
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description);
  return data.result;
}

// ============================================
// API ROUTES
// ============================================

// Health
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', botConfigured: !!BOT_TOKEN, timestamp: new Date().toISOString() });
});

// Auth
app.post('/api/auth', (req, res) => {
  try {
    const { initData } = req.body;
    const { valid, user: tgUser, demo } = validateInitData(initData);
    
    const mockUser = tgUser || { id: 123456789, username: 'demo_user', first_name: 'Demo' };
    const user = getOrCreateUser(mockUser);
    
    if (user.is_banned) return res.status(403).json({ error: 'Banned' });

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

// Balance
app.get('/api/balance', authMiddleware, (req, res) => {
  const user = getOrCreateUser(req.telegramUser);
  res.json({ success: true, balance: user.balance, hasBoost: !!user.has_boost });
});

// Spin
app.post('/api/spin', authMiddleware, (req, res) => {
  try {
    const { bet } = req.body;
    const user = getOrCreateUser(req.telegramUser);

    if (user.is_banned) return res.status(403).json({ error: 'Banned' });
    if (!VALID_BETS.includes(bet)) return res.status(400).json({ error: 'Invalid bet' });
    if (user.balance < bet) return res.status(400).json({ error: 'Insufficient balance' });

    const targetSlot = getRandomPrizeIndex();
    const prize = PRIZES[targetSlot];

    let winAmount = 0;
    let newHasBoost = user.has_boost;
    const boostUsed = user.has_boost && !prize.isBoost;

    if (prize.isBoost) {
      newHasBoost = 1;
    } else if (prize.multiplier > 0) {
      winAmount = Math.floor(bet * prize.multiplier);
      if (boostUsed) {
        winAmount *= 2;
        newHasBoost = 0;
      }
    }

    const newBalance = user.balance - bet + winAmount;

    stmt.updateUserStats.run(newBalance, bet, winAmount, newHasBoost, user.id);
    stmt.createSpin.run(user.id, bet, targetSlot, winAmount, newBalance, boostUsed ? 1 : 0);

    console.log(`🎰 User ${user.id}: bet ${bet}⭐ → ${prize.image} → won ${winAmount}⭐`);

    res.json({
      success: true,
      targetSlot,
      prize: { id: prize.id, image: prize.image, name: prize.name, value: prize.value, multiplier: prize.multiplier, isBoost: prize.isBoost },
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

// History
app.get('/api/history', authMiddleware, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const user = getOrCreateUser(req.telegramUser);
  const spins = stmt.getUserSpins.all(user.id, limit);
  
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
});

// Deposit
app.post('/api/deposit', authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    const user = getOrCreateUser(req.telegramUser);

    if (!BOT_TOKEN) return res.status(400).json({ error: 'Payments not configured' });

    const option = DEPOSIT_OPTIONS.find(o => o.amount === amount);
    if (!option) return res.status(400).json({ error: 'Invalid amount' });

    const bonus = Math.floor(amount * option.bonus / 100);
    const total = amount + bonus;

    const payload = JSON.stringify({ type: 'deposit', txId: Date.now(), userId: user.id, amount: total });
    stmt.createTransaction.run(user.id, 'deposit', total, amount, bonus, payload, 'pending');

    console.log(`💳 Invoice: user ${user.id}, ${amount}⭐ + ${bonus} bonus`);

    const invoiceLink = await telegramAPI('createInvoiceLink', {
      title: `Пополнение ${amount}⭐`,
      description: bonus > 0 ? `+${option.bonus}% бонус` : 'Пополнение баланса',
      payload,
      currency: 'XTR',
      prices: [{ label: `${amount} Stars`, amount }]
    });

    res.json({ success: true, invoiceLink, amount, bonus, total });
  } catch (e) {
    console.error('Deposit error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Deposit options
app.get('/api/deposit-options', (req, res) => {
  res.json({ success: true, options: DEPOSIT_OPTIONS, currency: 'XTR' });
});

// Admin stats
app.get('/api/admin/stats', authMiddleware, adminMiddleware, (req, res) => {
  const stats = stmt.getStats.get();
  res.json({ success: true, stats });
});

// Admin set balance
app.post('/api/admin/set-balance', authMiddleware, adminMiddleware, (req, res) => {
  const { userId, balance } = req.body;
  stmt.setBalance.run(balance, userId);
  res.json({ success: true });
});

// Webhook
app.post('/api/webhook', async (req, res) => {
  try {
    const update = req.body;

    if (update.pre_checkout_query) {
      await telegramAPI('answerPreCheckoutQuery', { pre_checkout_query_id: update.pre_checkout_query.id, ok: true });
    }

    if (update.message?.successful_payment) {
      const payment = update.message.successful_payment;
      const userId = update.message.from.id;

      console.log(`✅ Payment: ${userId} - ${payment.total_amount} ${payment.currency}`);

      try {
        const payload = JSON.parse(payment.invoice_payload);
        if (payload.type === 'deposit') {
          const tx = stmt.getPendingTransaction.get(payment.invoice_payload);
          if (tx) {
            stmt.updateTransaction.run('completed', payment.telegram_payment_charge_id, tx.id);
            stmt.addDeposit.run(payload.amount, payload.amount, payload.userId);
            
            const user = stmt.getUser.get(payload.userId);
            console.log(`💰 User ${payload.userId}: +${payload.amount}⭐ = ${user?.balance}⭐`);

            await telegramAPI('sendMessage', {
              chat_id: userId,
              text: `✅ Баланс пополнен на ${payload.amount}⭐!\n💳 Текущий баланс: ${user?.balance}⭐`,
              parse_mode: 'Markdown'
            });
          }
        }
      } catch (e) {
        console.error('Payment processing error:', e);
      }
    }

    if (update.message?.text?.startsWith('/')) {
      const chatId = update.message.chat.id;
      const text = update.message.text;
      const webAppUrl = FRONTEND_URL !== '*' ? FRONTEND_URL.split(',')[0] : null;

      if (text === '/start') {
        await telegramAPI('sendMessage', {
          chat_id: chatId,
          text: `🎰 *Добро пожаловать в Roulette!*\n\nКрути рулетку и выигрывай ⭐\n🎁 Бонус: ${INITIAL_BALANCE}⭐`,
          parse_mode: 'Markdown',
          reply_markup: webAppUrl ? { inline_keyboard: [[{ text: '🎮 Играть', web_app: { url: webAppUrl } }]] } : undefined
        });
      }

      if (text === '/balance') {
        const user = stmt.getUser.get(update.message.from.id);
        if (user) {
          await telegramAPI('sendMessage', {
            chat_id: chatId,
            text: `💰 Баланс: ${user.balance}⭐\n🎰 Спинов: ${user.total_spins}\n🏆 Выиграно: ${user.total_won}⭐`,
            parse_mode: 'Markdown'
          });
        }
      }
    }

    res.sendStatus(200);
  } catch (e) {
    console.error('Webhook error:', e);
    res.sendStatus(200);
  }
});

// Set webhook
app.get('/api/set-webhook', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL required' });
    const result = await telegramAPI('setWebhook', { url: `${url}/api/webhook`, allowed_updates: ['message', 'pre_checkout_query'] });
    console.log('✅ Webhook set:', url);
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Webhook info
app.get('/api/webhook-info', async (req, res) => {
  try {
    const result = await telegramAPI('getWebhookInfo', {});
    res.json({ success: true, info: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ============================================
// START
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🎰 ROULETTE BACKEND`);
  console.log(`   Server: http://localhost:${PORT}`);
  console.log(`   Bot: ${BOT_TOKEN ? '✅' : '❌ Demo mode'}`);
  console.log(`   Database: ${dbPath}\n`);
});

process.on('SIGTERM', () => { db.close(); process.exit(0); });
process.on('SIGINT', () => { db.close(); process.exit(0); });
