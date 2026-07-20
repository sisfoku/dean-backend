require('dotenv').config();
globalThis.WebSocket = require('ws');
const TelegramBot = require('node-telegram-bot-api');
const FlowHandler = require('./handlers/flowHandler');
const db = require('./db');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

console.log('🤖 Telegram AI Design Bot is running...');

// Test DB connection
db.query('SELECT NOW()').then(() => {
  console.log('✅ PostgreSQL connected');
}).catch(err => {
  console.error('❌ PostgreSQL connection failed:', err.message);
  process.exit(1);
});

const userBuffers = new Map();
const userTimers = new Map();
const DEBOUNCE_TIME_MS = 5000;

// Jalankan auto-cleanup asset lama setiap 24 jam
const SessionService = require('./services/sessionService');
setInterval(() => {
  SessionService.cleanupOldAssets().catch(e => console.error("Auto cleanup error:", e));
}, 24 * 60 * 60 * 1000); // 24 jam

// Handle semua pesan masuk
bot.on('message', async (msg) => {
  try {
    const userId = msg.chat.id;
    const text = msg.text?.trim() || msg.caption?.trim() || '';
    const photo = msg.photo;

    if (!text && !photo) return; // Ignore if completely empty

    // Jika pesan adalah command atau kirim gambar, langsung proses
    if (text === '/start' || text === '/baru' || ['baru', 'start'].includes(text?.toLowerCase()) || photo) {
      if (userTimers.has(userId)) clearTimeout(userTimers.get(userId));
      userTimers.delete(userId);
      userBuffers.delete(userId);
      await FlowHandler.handle(bot, msg);
      return;
    }

    // Tambahkan pesan teks ke buffer (debounce 5 detik)
    const currentBuffer = userBuffers.get(userId) || [];
    currentBuffer.push(text);
    userBuffers.set(userId, currentBuffer);

    // Reset timer jika user mengirim pesan lagi sebelum waktunya habis
    if (userTimers.has(userId)) {
      clearTimeout(userTimers.get(userId));
    }

    const timer = setTimeout(async () => {
      const texts = userBuffers.get(userId) || [];
      if (texts.length === 0) return;

      const combinedText = texts.join('\n');
      userBuffers.delete(userId);
      userTimers.delete(userId);

      // Buat object message gabungan
      const combinedMsg = { ...msg, text: combinedText, photo: undefined }; // pastikan bukan photo karena sdh ditangani

      try {
        await FlowHandler.handle(bot, combinedMsg);
      } catch (err) {
        console.error('Handler error:', err);
        bot.sendMessage(userId, '❌ Terjadi kesalahan. Coba ketik /start untuk mulai ulang.');
      }
    }, DEBOUNCE_TIME_MS);

    userTimers.set(userId, timer);

  } catch (err) {
    console.error('Message listener error:', err);
  }
});

// Handle polling errors
bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await db.end();
  process.exit(0);
});
