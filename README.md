# Mail Cron Service v2

A **serverless-compatible** Node.js service that monitors Gmail and Outlook mailboxes for placement/interview emails and sends Telegram notifications.

## ✨ Features

- 🤖 **Interactive Telegram Bot** - Self-service user registration
- 🔐 **OAuth Web Flow** - Secure email account connection  
- 🗄️ **MongoDB Storage** - Persistent users, emails, settings
- ⚡ **Serverless Ready** - Deploy to Vercel, Render, Railway
- 📧 **Email History** - All important emails stored in database
- 🎯 **2-Level AI Classification** - Keywords + Gemini AI

## 🚀 Quick Start

### 1. Clone and Install
```bash
git clone <repo>
cd mail-cron
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your credentials
```

### 3. Deploy to Vercel (Serverless)
```bash
npm i -g vercel
vercel
```

### 4. Setup Webhook (One-time)
After deploying, visit:
```
https://your-app.vercel.app/webhook/setup
```

### 5. Configure Cron
Set up cronjob.org to hit `https://your-app.vercel.app/cron/check` every 15 minutes.

---

## 📱 How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                     USER ONBOARDING                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  User sends /start ──────► Webhook receives message             │
│                            Serverless function processes        │
│                            Bot replies with welcome + buttons   │
│                                                                 │
│  User clicks [Gmail] ────► Opens OAuth consent in browser       │
│  User authorizes ────────► Callback saves token to MongoDB      │
│                            Bot notifies "Gmail Connected!"      │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                     CRON PROCESSING                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  cronjob.org ────────────► GET /cron/check                      │
│                            Fetches emails for all users         │
│                            Classifies with Keywords + AI        │
│                            Sends Telegram notifications         │
│                            Stores emails in MongoDB             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔌 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with MongoDB status |
| `/webhook/telegram` | POST | Telegram webhook (receives bot updates) |
| `/webhook/setup` | GET | **Call once after deploy** to register webhook |
| `/webhook/status` | GET | Check current webhook status |
| `/cron/check` | GET | Process all users (for cronjob.org) |
| `/oauth/gmail/start` | GET | Gmail OAuth flow |
| `/oauth/outlook/start` | GET | Outlook OAuth flow |

---

## 🤖 Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Begin setup wizard |
| `/add` | Connect another email account |
| `/status` | Check connection status |
| `/history` | View recent important emails |
| `/settings` | View notification settings |
| `/pause` / `/resume` | Toggle notifications |
| `/help` | Show all commands |

---

## ⚙️ Environment Variables

```env
# REQUIRED
BASE_URL=https://your-app.vercel.app
MONGODB_URI=mongodb+srv://...
TELEGRAM_BOT_TOKEN=123456789:ABC...

# Gmail OAuth
GMAIL_CLIENT_ID=xxx.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=xxx

# Outlook OAuth
OUTLOOK_CLIENT_ID=xxx
OUTLOOK_CLIENT_SECRET=xxx
OUTLOOK_TENANT_ID=common

# Optional
GEMINI_API_KEY=xxx
```

---

## 📁 Project Structure

```
mail-cron/
├── vercel.json           # Vercel serverless config
├── package.json
├── .env.example
├── README.md
├── docs/
│   └── SETUP.md          # Detailed setup guide
└── src/
    ├── server.js         # Express + webhook routes
    ├── models/
    │   └── index.js      # MongoDB schemas
    ├── helpers/
    │   ├── bot.js        # Telegram bot (webhook mode)
    │   ├── database.js   # MongoDB operations
    │   ├── gmail.js      # Gmail OAuth + API
    │   ├── outlook.js    # Outlook OAuth + API
    │   └── classifier.js # Email classification
    └── utils/
        └── logger.js     # Logging
```

---

## 🚢 Deployment Options

### Vercel (Recommended for Serverless)
```bash
vercel
# Then visit: https://your-app.vercel.app/webhook/setup
```

### Render
1. Connect GitHub repo
2. Set environment variables
3. Visit `/webhook/setup` after deploy

### Railway
1. Create project from GitHub
2. Add MongoDB plugin
3. Set environment variables
4. Visit `/webhook/setup`

---

## 📧 Email Categories

- 🎓 **PLACEMENT_DRIVE** - Campus placement announcements
- 🎤 **INTERVIEW** - Interview invitations
- 📝 **ASSESSMENT** - Online tests, coding challenges
- 🎉 **SHORTLISTED** - Selection notifications

---

## 🔧 Setup Checklist

- [ ] Create Telegram bot via @BotFather
- [ ] Set up MongoDB Atlas (free tier works)
- [ ] Create Gmail OAuth app in Google Cloud Console
- [ ] Create Azure app for Outlook OAuth
- [ ] Deploy to Vercel/Render/Railway
- [ ] Set BASE_URL to deployed URL
- [ ] Visit `/webhook/setup` to register webhook
- [ ] Configure cronjob.org to hit `/cron/check`
- [ ] Test by sending `/start` to your bot!

See [docs/SETUP.md](docs/SETUP.md) for detailed instructions.

---

## License

MIT
