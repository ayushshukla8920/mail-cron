# Setup Guide v2

Complete instructions for setting up the Mail Cron Service with MongoDB and interactive Telegram bot.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [MongoDB Setup](#1-mongodb-setup)
3. [Creating Telegram Bot](#2-creating-telegram-bot)
4. [Setting up Gmail OAuth](#3-setting-up-gmail-oauth)
5. [Setting up Outlook OAuth](#4-setting-up-outlook-oauth)
6. [Local Development](#5-local-development)
7. [Deploying the Service](#6-deploying-the-service)
8. [Configuring cronjob.org](#7-configuring-cronjobarg)

---

## Prerequisites

- Node.js 18+ installed
- MongoDB 6+ (local or cloud like MongoDB Atlas)
- A Telegram account
- Google Cloud Console account
- Azure Portal account (for Outlook)

---

## 1. MongoDB Setup

### Option A: MongoDB Atlas (Cloud - Recommended)

1. Go to [MongoDB Atlas](https://www.mongodb.com/atlas)
2. Create a free account
3. Create a new cluster (Free tier is fine)
4. Click "Connect" → "Connect your application"
5. Copy the connection string

Add to your `.env`:
```env
MONGODB_URI=mongodb+srv://username:password@cluster.xxxxx.mongodb.net/mail-cron?retryWrites=true&w=majority
```

### Option B: Local MongoDB

```bash
# macOS with Homebrew
brew tap mongodb/brew
brew install mongodb-community
brew services start mongodb-community

# Ubuntu
sudo apt install mongodb
sudo systemctl start mongodb
```

Add to your `.env`:
```env
MONGODB_URI=mongodb://localhost:27017/mail-cron
```

---

## 2. Creating Telegram Bot

### Step 1: Create the bot

1. Open Telegram and search for `@BotFather`
2. Send `/newbot` command
3. Follow prompts to name your bot (e.g., "Mail Cron Bot")
4. Copy the **HTTP API token**

### Step 2: Save configuration

Add to your `.env`:
```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
```

### Step 3: Configure bot settings (optional)

Send these commands to @BotFather:

```
/setdescription
Mail Cron Bot - Get notified about important placement and interview emails

/setabouttext
I monitor your Gmail and Outlook for placement drives, interviews, and assessments. Send /start to begin!

/setcommands
start - Begin setup wizard
add - Connect a new email account
status - Check connection status
settings - View notification settings
history - View recent important emails
pause - Pause notifications
resume - Resume notifications
help - Show all commands
```

---

## 3. Setting up Gmail OAuth

### Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project: "Mail Cron Service"
3. Enable the **Gmail API**:
   - Go to "APIs & Services" > "Library"
   - Search for "Gmail API" → Click "Enable"

### Step 2: Configure OAuth Consent Screen

1. Go to "APIs & Services" > "OAuth consent screen"
2. Select "External" user type
3. Fill in:
   - App name: "Mail Cron Bot"
   - User support email: your email
   - Developer contact: your email
4. Add scopes:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/userinfo.email`
5. Add test users (if not publishing the app)

### Step 3: Create OAuth Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth client ID"
3. Application type: "Web application"
4. Name: "Mail Cron Web Client"
5. Authorized redirect URIs:
   - Local: `http://localhost:3000/oauth/gmail/callback`
   - Production: `https://your-domain.com/oauth/gmail/callback`
6. Click "Create"
7. Copy **Client ID** and **Client Secret**

### Step 4: Save credentials

Add to your `.env`:
```env
GMAIL_CLIENT_ID=123456789-xxxxxx.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxx
```

---

## 4. Setting up Outlook OAuth

### Step 1: Register Azure Application

1. Go to [Azure Portal](https://portal.azure.com/)
2. Navigate to "Azure Active Directory" > "App registrations"
3. Click "New registration"
4. Fill in:
   - Name: "Mail Cron Bot"
   - Supported account types: "Personal Microsoft accounts only" or "Accounts in any organizational directory and personal Microsoft accounts"
   - Redirect URI: Web - `http://localhost:3000/oauth/outlook/callback`
5. Click "Register"

### Step 2: Note Application Details

From the Overview page, copy:
- **Application (client) ID**
- **Directory (tenant) ID** (use "common" or "consumers" for personal accounts)

### Step 3: Create Client Secret

1. Go to "Certificates & secrets"
2. Click "New client secret"
3. Add description: "Mail Cron Secret"
4. Choose expiry (e.g., 24 months)
5. Click "Add"
6. **Copy the Value immediately** (won't be shown again)

### Step 4: Configure API Permissions

1. Go to "API permissions"
2. Click "Add a permission" > "Microsoft Graph"
3. Select "Delegated permissions"
4. Add:
   - `Mail.Read`
   - `User.Read`
   - `offline_access`
5. Click "Add permissions"

### Step 5: Add Redirect URIs (Production)

1. Go to "Authentication"
2. Under "Web" > "Redirect URIs", add:
   - `https://your-domain.com/oauth/outlook/callback`

### Step 6: Save credentials

Add to your `.env`:
```env
OUTLOOK_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
OUTLOOK_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
OUTLOOK_TENANT_ID=common
```

---

## 5. Local Development

### Step 1: Install dependencies

```bash
cd mail-cron
npm install
```

### Step 2: Configure environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

Your `.env` should look like:
```env
PORT=3000
BASE_URL=http://localhost:3000

MONGODB_URI=mongodb://localhost:27017/mail-cron

TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz

GMAIL_CLIENT_ID=xxx.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=xxx

OUTLOOK_CLIENT_ID=xxx
OUTLOOK_CLIENT_SECRET=xxx
OUTLOOK_TENANT_ID=common

GEMINI_API_KEY=xxx
```

### Step 3: Start MongoDB

```bash
# If using local MongoDB
mongod
```

### Step 4: Start the server

```bash
npm start
```

You should see:
```
[INFO] Connected to MongoDB
[INFO] Telegram bot initialized
[INFO] Server started | {"port":"3000"}
```

### Step 5: Test the bot

1. Open Telegram
2. Search for your bot by username
3. Send `/start`
4. Follow the onboarding flow

---

## 6. Deploying the Service

### Option A: Render.com (Recommended)

1. Create account at [render.com](https://render.com)
2. Create new "Web Service" from GitHub repo
3. Configure:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance type: Free or Starter
4. Add environment variables (all from your `.env`)
5. Set `BASE_URL` to your Render URL (e.g., `https://mail-cron.onrender.com`)
6. Deploy

**Important**: Update OAuth redirect URIs in Google Cloud and Azure Portal!

### Option B: Railway.app

1. Create account at [railway.app](https://railway.app)
2. Create project from GitHub
3. Add MongoDB plugin (Railway provides it)
4. Add environment variables
5. Deploy

### Option C: Fly.io

```bash
# Install flyctl
brew install flyctl

# Login and launch
fly auth login
fly launch

# Set secrets
fly secrets set TELEGRAM_BOT_TOKEN=xxx
fly secrets set MONGODB_URI=xxx
fly secrets set GMAIL_CLIENT_ID=xxx
fly secrets set GMAIL_CLIENT_SECRET=xxx
fly secrets set OUTLOOK_CLIENT_ID=xxx
fly secrets set OUTLOOK_CLIENT_SECRET=xxx
fly secrets set OUTLOOK_TENANT_ID=common
fly secrets set GEMINI_API_KEY=xxx
fly secrets set BASE_URL=https://your-app.fly.dev

# Deploy
fly deploy
```

### Option D: VPS (DigitalOcean, etc.)

```bash
# On your server
git clone <your-repo>
cd mail-cron
npm install

# Setup PM2
npm install -g pm2
pm2 start src/server.js --name mail-cron
pm2 save
pm2 startup

# Setup nginx reverse proxy (optional but recommended)
```

---

## 7. Configuring cronjob.org

1. Create account at [cron-job.org](https://console.cron-job.org/)

2. Click "Create Cronjob"

3. Configure:
   - **Title**: Mail Cron Check
   - **URL**: `https://your-domain.com/cron/check`
   - **Schedule**: Every 15 minutes (`*/15 * * * *`)
   - **Request Method**: GET
   - **Enable job**: Yes

4. Optional settings:
   - Timeout: 120 seconds
   - Notification: On failure
   - Save response: Yes

5. Click "Create"

6. Test by clicking "Run Now"

### Cron Schedule Examples

| Frequency | Expression |
|-----------|------------|
| Every 5 min | `*/5 * * * *` |
| Every 15 min | `*/15 * * * *` |
| Every 30 min | `*/30 * * * *` |
| Every hour | `0 * * * *` |

---

## Troubleshooting

### "Access blocked" on Gmail OAuth

- Ensure user is added as test user in OAuth consent screen
- Or publish the app (requires Google verification)

### "Need admin approval" on Outlook OAuth

- Use `OUTLOOK_TENANT_ID=consumers` for personal accounts
- Or use `OUTLOOK_TENANT_ID=common` for both org and personal

### Bot not responding

1. Check logs: `npm start` in terminal
2. Verify `TELEGRAM_BOT_TOKEN` is correct
3. Ensure only one instance is running (Telegram only allows one polling connection)

### OAuth callback error

1. Verify redirect URI matches exactly in provider console
2. Check `BASE_URL` is set correctly
3. Ensure HTTPS in production

### MongoDB connection failed

1. Check `MONGODB_URI` is correct
2. For Atlas: whitelist your IP in Network Access
3. Check MongoDB is running (if local)

---

## Security Notes

1. **Never commit `.env`** - It's in `.gitignore`
2. **Rotate secrets periodically** - Especially OAuth client secrets
3. **Use HTTPS in production** - Required for OAuth callbacks
4. **Monitor usage** - Check for unusual API activity
5. **Limit OAuth scopes** - Only request what's needed
