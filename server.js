const express = require('express');
const crypto = require('crypto');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-Telegram-Init-Data']
}));
app.use(express.json());

// Получаем токен бота из переменных окружения
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.warn('⚠️  WARNING: BOT_TOKEN is not set! Set it in environment variables.');
}

// ============================================
// ВАЛИДАЦИЯ INIT DATA ОТ TELEGRAM
// ============================================
function validateInitData(initData) {
  if (!initData || !BOT_TOKEN) {
    return { valid: false, user: null };
  }

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');

    // Собираем строку для проверки
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    // Создаём секретный ключ
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(BOT_TOKEN)
      .digest();

    // Вычисляем хеш
    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (calculatedHash !== hash) {
      return { valid: false, user: null };
    }

    // Парсим данные пользователя
    const userStr = params.get('user');
    const user = userStr ? JSON.parse(userStr) : null;

    return { valid: true, user };
  } catch (error) {
    console.error('Error validating initData:', error);
    return { valid: false, user: null };
  }
}

// ============================================
// MIDDLEWARE ДЛЯ АВТОРИЗАЦИИ
// ============================================
function authMiddleware(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];
  
  const { valid, user } = validateInitData(initData);
  
  if (!valid) {
    return res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'Invalid or missing Telegram initData' 
    });
  }
  
  req.telegramUser = user;
  next();
}

// ============================================
// API ENDPOINTS
// ============================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    botConfigured: !!BOT_TOKEN
  });
});

// Получить информацию о пользователе
app.get('/api/user', authMiddleware, (req, res) => {
  res.json({ 
    success: true, 
    user: req.telegramUser 
  });
});

// Получить список продуктов
app.get('/api/products', (req, res) => {
  const products = [
    {
      id: 'premium_week',
      title: 'Premium на неделю',
      description: 'Доступ ко всем премиум функциям на 7 дней',
      price: 50,
      emoji: '🚀'
    },
    {
      id: 'premium_month',
      title: 'Premium на месяц',
      description: 'Полный доступ ко всем функциям на 30 дней',
      price: 150,
      emoji: '💎'
    },
    {
      id: 'coins_100',
      title: '100 монет',
      description: 'Виртуальная валюта для покупок в приложении',
      price: 25,
      emoji: '🪙'
    },
    {
      id: 'special_badge',
      title: 'Особый значок',
      description: 'Эксклюзивный значок для вашего профиля',
      price: 100,
      emoji: '🏆'
    }
  ];
  
  res.json({ success: true, products });
});

// ============================================
// СОЗДАНИЕ ИНВОЙСА ДЛЯ ОПЛАТЫ В STARS
// ============================================
app.post('/api/create-invoice', authMiddleware, async (req, res) => {
  try {
    const { productId, title, description, price } = req.body;
    const user = req.telegramUser;

    if (!productId || !price) {
      return res.status(400).json({ 
        error: 'Bad Request', 
        message: 'productId and price are required' 
      });
    }

    console.log(`📦 Creating invoice for user ${user.id}: ${productId} - ${price} Stars`);

    // Создаём инвойс через Telegram Bot API
    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title || `Покупка: ${productId}`,
          description: description || `Покупка ${productId} за ${price} Stars`,
          payload: JSON.stringify({ 
            productId, 
            userId: user.id,
            timestamp: Date.now() 
          }),
          currency: 'XTR', // XTR = Telegram Stars
          prices: [{ 
            label: title || productId, 
            amount: price 
          }]
        })
      }
    );

    const data = await response.json();

    if (!data.ok) {
      console.error('Telegram API error:', data);
      throw new Error(data.description || 'Failed to create invoice');
    }

    console.log(`✅ Invoice created: ${data.result}`);
    
    res.json({ 
      success: true, 
      invoiceLink: data.result 
    });
  } catch (error) {
    console.error('Error creating invoice:', error);
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: error.message 
    });
  }
});

// ============================================
// WEBHOOK ДЛЯ ОБРАБОТКИ ПЛАТЕЖЕЙ
// ============================================
app.post('/api/webhook', async (req, res) => {
  try {
    const update = req.body;
    
    console.log('📨 Received webhook update:', JSON.stringify(update, null, 2));

    // Обработка pre_checkout_query (подтверждение перед оплатой)
    if (update.pre_checkout_query) {
      const query = update.pre_checkout_query;
      console.log(`💳 Pre-checkout query from user ${query.from.id}`);
      
      // Здесь можно добавить проверку наличия товара, лимитов и т.д.
      // Если всё ок - подтверждаем
      const response = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/answerPreCheckoutQuery`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pre_checkout_query_id: query.id,
            ok: true
          })
        }
      );
      
      const data = await response.json();
      console.log('Pre-checkout response:', data);
    }

    // Обработка успешного платежа
    if (update.message?.successful_payment) {
      const payment = update.message.successful_payment;
      const userId = update.message.from.id;
      const payload = JSON.parse(payment.invoice_payload);
      
      console.log('═══════════════════════════════════════');
      console.log('✅ SUCCESSFUL PAYMENT');
      console.log(`   User ID: ${userId}`);
      console.log(`   Amount: ${payment.total_amount} ${payment.currency}`);
      console.log(`   Product: ${payload.productId}`);
      console.log(`   Telegram Payment ID: ${payment.telegram_payment_charge_id}`);
      console.log('═══════════════════════════════════════');

      // ========================================
      // ЗДЕСЬ ДОБАВЬТЕ ВАШУ ЛОГИКУ:
      // 1. Сохранить покупку в базу данных
      // 2. Выдать товар пользователю
      // 3. Отправить уведомление пользователю
      // ========================================
      
      // Пример: отправляем сообщение пользователю
      await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: userId,
            text: `🎉 Спасибо за покупку!\n\nВаш заказ: ${payload.productId}\nСумма: ${payment.total_amount} ⭐ Stars\n\nТовар активирован!`
          })
        }
      );
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(200); // Всегда возвращаем 200, чтобы Telegram не повторял запрос
  }
});

// ============================================
// ЗАПУСК СЕРВЕРА
// ============================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('═══════════════════════════════════════');
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Bot Token: ${BOT_TOKEN ? '✅ Configured' : '❌ Not set'}`);
  console.log('═══════════════════════════════════════');
  console.log('');
  console.log('Endpoints:');
  console.log(`  GET  /api/health         - Health check`);
  console.log(`  GET  /api/user           - Get user info`);
  console.log(`  GET  /api/products       - Get products list`);
  console.log(`  POST /api/create-invoice - Create Stars invoice`);
  console.log(`  POST /api/webhook        - Telegram webhook`);
  console.log('');
});
