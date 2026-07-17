# 🤖 Telegram AI Design Bot

Bot Telegram untuk generate desain poster/flyer menggunakan GPT-4o Image Generation.

## Stack
- **Node.js** — Runtime
- **PostgreSQL** — Database (stateful session)
- **Docker** — Container
- **OpenAI GPT-4o** — Image generation
- **Telegram Bot API** — Interface

---

## Cara Setup

### 1. Clone & Konfigurasi
```bash
cp .env.example .env
```

Isi `.env` dengan:
```
TELEGRAM_TOKEN=   # dari @BotFather
OPENAI_API_KEY=   # dari platform.openai.com
DB_USER=botuser
DB_PASSWORD=botpassword123
DB_NAME=telegram_bot
DB_HOST=postgres
DB_PORT=5432
```

### 2. Run dengan Docker
```bash
docker-compose up --build
```

Bot langsung aktif + PostgreSQL otomatis setup!

### 3. Development Lokal (tanpa Docker)
```bash
npm install

# Ganti DB_HOST=localhost di .env
DB_HOST=localhost

node src/index.js
```

---

## Flow Bot

```
/start
  → Jenis desain?
  → Gaya visual?
  → Warna dominan?
  → Headline/teks utama?
  → Harga? (opsional)
  → Cicilan? (opsional)
  → Tipe rumah? (opsional)
  → Fasilitas? (opsional)
  → Gratis/bonus? (opsional)
  → Lokasi? (opsional)
  → Nomor WA? (opsional)
  → Upload foto rumah? (opsional)
  → Konfirmasi summary
  → GENERATE ✅
  → Revisi (loop, expires 7 hari)
```

---

## Commands

| Command | Fungsi |
|---|---|
| `/start` | Mulai bot / buat desain baru |
| `/baru` | Reset & mulai dari awal |

---

## Session Management

| Kondisi | Behaviour |
|---|---|
| Session aktif | Lanjut dari step terakhir |
| Tidak aktif < 24 jam | Tanya mau lanjut atau baru |
| Sudah generate gambar | Simpan 7 hari untuk revisi |
| Tidak aktif > 7 hari | Reset otomatis |

---

## Struktur Project

```
telegram-ai-bot/
├── docker-compose.yml
├── Dockerfile
├── package.json
├── .env.example
├── docker/
│   └── init.sql          # Schema PostgreSQL
└── src/
    ├── index.js           # Entry point
    ├── db/
    │   └── index.js       # PostgreSQL connection
    ├── handlers/
    │   └── flowHandler.js # Conversation flow
    └── services/
        ├── sessionService.js  # Session CRUD
        ├── promptService.js   # Prompt engineering
        └── imageService.js    # OpenAI image gen
```
