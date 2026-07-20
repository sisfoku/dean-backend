require('dotenv').config();
globalThis.WebSocket = require('ws');
const TelegramBot = require('node-telegram-bot-api');
const FlowHandler = require('./handlers/flowHandler');
const db = require('./db');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🤖 Telegram AI Design Bot is starting...');
console.log(`🕐 Timestamp: ${new Date().toISOString()}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// ─── Cek semua environment variables yang dibutuhkan ───────────────────────
console.log('\n🔍 Checking environment variables...');
const requiredEnvVars = [
  'TELEGRAM_TOKEN',
  'OPENAI_API_KEY',
  'OPENAI_IMAGE_KEY',
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
];
const optionalEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_KEY',
  'SESSION_EXPIRY_HOURS',
];

let missingRequired = false;
for (const key of requiredEnvVars) {
  if (process.env[key]) {
    const val = key.toLowerCase().includes('token') || key.toLowerCase().includes('key') || key.toLowerCase().includes('password')
      ? `***${process.env[key].slice(-4)}`  // Sensor, tampilkan 4 karakter terakhir
      : process.env[key];
    console.log(`  ✅ ${key} = ${val}`);
  } else {
    console.error(`  ❌ MISSING: ${key} — WAJIB ADA!`);
    missingRequired = true;
  }
}
for (const key of optionalEnvVars) {
  if (process.env[key]) {
    console.log(`  ✅ ${key} = (set)`);
  } else {
    console.warn(`  ⚠️  ${key} = (tidak diset — fitur terkait mungkin tidak berfungsi)`);
  }
}

if (missingRequired) {
  console.error('\n❌ Ada env var wajib yang tidak diset. Bot tidak dapat berjalan dengan benar.');
  process.exit(1);
}
console.log('');

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
console.log('✅ Telegram bot instance created.');

// Test DB connection
db.query('SELECT NOW()').then((res) => {
  console.log(`✅ PostgreSQL connected — server time: ${res.rows[0].now}`);
}).catch(err => {
  console.error('❌ PostgreSQL connection failed:', err.message);
  console.error('   DB Config → host:', process.env.DB_HOST, '| port:', process.env.DB_PORT, '| db:', process.env.DB_NAME, '| user:', process.env.DB_USER);
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
    const username = msg.chat.username || msg.chat.first_name || 'unknown';
    const text = msg.text?.trim() || msg.caption?.trim() || '';
    const photo = msg.photo;

    console.log(`\n📨 [MSG] userId=${userId} username=@${username} | text=${text ? `"${text.substring(0,80)}"` : '(none)'} | photo=${photo ? 'YES' : 'NO'}`);

    if (!text && !photo) {
      console.log(`   ⏭️  Pesan diabaikan (tidak ada teks atau foto).`);
      return;
    }

    // Jika pesan adalah command atau kirim gambar, langsung proses
    if (text === '/start' || text === '/baru' || ['baru', 'start'].includes(text?.toLowerCase()) || photo) {
      console.log(`   ⚡ Command/foto terdeteksi — langsung proses tanpa debounce.`);
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
    console.log(`   ⏳ Debounce buffer userId=${userId}: ${currentBuffer.length} pesan, menunggu ${DEBOUNCE_TIME_MS/1000}s...`);

    // Reset timer jika user mengirim pesan lagi sebelum waktunya habis
    if (userTimers.has(userId)) {
      clearTimeout(userTimers.get(userId));
      console.log(`   🔄 Timer di-reset untuk userId=${userId}`);
    }

    const timer = setTimeout(async () => {
      const texts = userBuffers.get(userId) || [];
      if (texts.length === 0) return;

      const combinedText = texts.join('\n');
      userBuffers.delete(userId);
      userTimers.delete(userId);

      console.log(`   🚀 Debounce selesai userId=${userId} — menggabungkan ${texts.length} pesan → "${combinedText.substring(0,80)}"`);

      // Buat object message gabungan
      const combinedMsg = { ...msg, text: combinedText, photo: undefined };

      try {
        await FlowHandler.handle(bot, combinedMsg);
      } catch (err) {
        console.error(`   ❌ FlowHandler.handle error untuk userId=${userId}:`, err);
        bot.sendMessage(userId, '❌ Terjadi kesalahan. Coba ketik /start untuk mulai ulang.');
      }
    }, DEBOUNCE_TIME_MS);

    userTimers.set(userId, timer);

  } catch (err) {
    console.error('❌ Message listener error:', err);
  }
});

// Handle polling errors
bot.on('polling_error', (err) => {
  console.error('❌ Polling error:', err.code, err.message);
});

bot.on('error', (err) => {
  console.error('❌ Bot error:', err.message);
});

console.log('✅ Telegram AI Design Bot is running and listening for messages...');

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await db.end();
  process.exit(0);
});
