/**
 * Mail Cron Service - Main Server (Serverless Compatible)
 * Express server with webhook-based Telegram bot and MongoDB storage
 * Works on: Vercel, Render, Railway, Fly.io, etc.
 */

require('dotenv').config();

const express = require('express');
const logger = require('./utils/logger');
const db = require('./helpers/database');
const bot = require('./helpers/bot');
const gmail = require('./helpers/gmail');
const outlook = require('./helpers/outlook');
const classifier = require('./helpers/classifier');

// Initialize Express app
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuration
const PORT = process.env.PORT || 3000;
const DEFAULT_LOOKBACK_MINUTES = 30;

// Track if initialized (for serverless cold starts)
let isInitialized = false;

/**
 * Initialize services (MongoDB, Bot)
 * Called on first request in serverless environment
 */
async function ensureInitialized() {
    if (isInitialized) return;

    try {
        await db.connect();
        bot.initBot();
        isInitialized = true;
        logger.info('Services initialized');
    } catch (error) {
        logger.error('Failed to initialize services', { error: error.message });
        throw error;
    }
}

/**
 * Generate unique run ID
 */
function generateRunId() {
    return `run_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

/**
 * Calculate since timestamp for fetching emails
 */
function getSinceTimestamp(user, provider) {
    const lastChecked = user.lastChecked?.[provider];

    if (lastChecked) {
        const thirtyMinsAgo = Date.now() - (DEFAULT_LOOKBACK_MINUTES * 60 * 1000);
        return Math.max(new Date(lastChecked).getTime(), thirtyMinsAgo);
    }

    return Date.now() - (DEFAULT_LOOKBACK_MINUTES * 60 * 1000);
}

/**
 * Process emails for a single user
 */
async function processUserEmails(user) {
    const result = {
        name: user.firstName,
        chatId: user.telegramChatId,
        emailsScanned: 0,
        importantFound: 0,
        notificationsSent: 0,
        errors: []
    };

    if (!user.settings?.notificationsEnabled) {
        logger.debug('Notifications paused for user', { chatId: user.telegramChatId });
        return result;
    }

    logger.info(`Processing user: ${user.firstName}`, { chatId: user.telegramChatId });

    // Process Gmail
    if (user.providers?.gmail?.enabled && user.providers.gmail.refreshToken) {
        try {
            const providerResult = await processProvider(user, 'gmail');
            result.emailsScanned += providerResult.emailsScanned;
            result.importantFound += providerResult.importantFound;
            result.notificationsSent += providerResult.notificationsSent;
        } catch (error) {
            result.errors.push(`gmail: ${error.message}`);
            await handleProviderFailure(user, 'gmail', error.message);
        }
    }

    // Process Outlook
    if (user.providers?.outlook?.enabled && user.providers.outlook.refreshToken) {
        try {
            const providerResult = await processProvider(user, 'outlook');
            result.emailsScanned += providerResult.emailsScanned;
            result.importantFound += providerResult.importantFound;
            result.notificationsSent += providerResult.notificationsSent;
        } catch (error) {
            result.errors.push(`outlook: ${error.message}`);
            await handleProviderFailure(user, 'outlook', error.message);
        }
    }

    return result;
}

/**
 * Process emails from a single provider
 */
async function processProvider(user, provider) {
    const result = {
        emailsScanned: 0,
        importantFound: 0,
        notificationsSent: 0
    };

    const refreshToken = user.providers[provider].refreshToken;
    const sinceTimestamp = getSinceTimestamp(user, provider);

    // Fetch emails
    let emails;
    if (provider === 'gmail') {
        emails = await gmail.fetchEmails(refreshToken, sinceTimestamp);
    } else {
        emails = await outlook.fetchEmails(refreshToken, sinceTimestamp);
    }

    result.emailsScanned = emails.length;

    // Process each email
    for (const email of emails) {
        try {
            const alreadyNotified = await db.isEmailNotified(
                user.telegramChatId,
                provider,
                email.messageId
            );

            if (alreadyNotified) continue;

            const classification = await classifier.classifyEmail(email);
            const categoryEnabled = user.settings?.categories?.[classification.category] !== false;

            if (classification.important && categoryEnabled) {
                result.importantFound++;

                const sent = await bot.sendEmailNotification(
                    user.telegramChatId,
                    email,
                    classification
                );

                if (sent) {
                    result.notificationsSent++;
                    await db.saveEmail(user, email, classification);
                }
            }
        } catch (emailError) {
            logger.warn('Failed to process email', { emailId: email.id, error: emailError.message });
        }
    }

    await db.updateLastChecked(user.telegramChatId, provider);

    return result;
}

/**
 * Handle provider failure
 */
async function handleProviderFailure(user, provider, errorMessage) {
    try {
        await db.recordProviderError(user.telegramChatId, provider, errorMessage);

        const canAlert = await db.canSendFailureAlert(user.telegramChatId, provider);

        if (canAlert) {
            const sent = await bot.sendFailureAlert(user.telegramChatId, provider, errorMessage);
            if (sent) {
                await db.recordFailureAlert(user.telegramChatId, provider);
            }
        }
    } catch (error) {
        logger.error('Failed to handle provider failure', { error: error.message });
    }
}

// ==================== ROUTES ====================

/**
 * Health check
 */
app.get('/health', async (req, res) => {
    try {
        await ensureInitialized();
        res.json({
            status: 'OK',
            mongodb: db.isConnected() ? 'connected' : 'disconnected',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ status: 'ERROR', error: error.message });
    }
});

/**
 * Telegram Webhook - receives all bot updates
 */
app.post('/webhook/telegram', async (req, res) => {
    try {
        await ensureInitialized();

        // Process the update asynchronously
        bot.processUpdate(req.body).catch(err => {
            logger.error('Error processing webhook update', { error: err.message });
        });

        // Respond immediately (Telegram expects 200 within 60 seconds)
        res.sendStatus(200);
    } catch (error) {
        logger.error('Webhook error', { error: error.message });
        res.sendStatus(500);
    }
});

/**
 * Setup webhook - call this once after deployment
 */
app.get('/webhook/setup', async (req, res) => {
    try {
        await ensureInitialized();

        const baseUrl = process.env.BASE_URL;
        if (!baseUrl) {
            return res.status(400).json({ error: 'BASE_URL not configured' });
        }

        const webhookUrl = `${baseUrl}/webhook/telegram`;
        await bot.setWebhook(webhookUrl);

        res.json({
            success: true,
            webhookUrl,
            message: 'Webhook set successfully. Your bot is now active!'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Check webhook status
 */
app.get('/webhook/status', async (req, res) => {
    try {
        await ensureInitialized();
        const info = await bot.getWebhookInfo();
        res.json(info);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Delete webhook (for debugging/switching back to polling)
 */
app.get('/webhook/delete', async (req, res) => {
    try {
        await ensureInitialized();
        await bot.deleteWebhook();
        res.json({ success: true, message: 'Webhook deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Cron endpoint - processes all users
 */
app.get('/cron/check', async (req, res) => {
    const runId = generateRunId();
    logger.cronStart(runId);

    const summary = {
        runId,
        startTime: new Date().toISOString(),
        usersProcessed: 0,
        emailsScanned: 0,
        importantFound: 0,
        notificationsSent: 0,
        failures: 0,
        userResults: []
    };

    try {
        await ensureInitialized();

        const users = await db.getActiveUsers();
        logger.info(`Processing ${users.length} active users`);

        for (const user of users) {
            try {
                const userResult = await processUserEmails(user);

                summary.usersProcessed++;
                summary.emailsScanned += userResult.emailsScanned;
                summary.importantFound += userResult.importantFound;
                summary.notificationsSent += userResult.notificationsSent;
                summary.failures += userResult.errors.length;

                summary.userResults.push({
                    chatId: userResult.chatId,
                    name: userResult.name,
                    emailsScanned: userResult.emailsScanned,
                    importantFound: userResult.importantFound,
                    notificationsSent: userResult.notificationsSent,
                    errors: userResult.errors
                });
            } catch (userError) {
                logger.error('User processing failed', { chatId: user.telegramChatId, error: userError.message });
                summary.failures++;
            }
        }

        summary.endTime = new Date().toISOString();
        summary.durationMs = Date.now() - new Date(summary.startTime).getTime();

        logger.cronEnd(runId, summary);
        res.json(summary);
    } catch (error) {
        logger.error('Cron run failed', { runId, error: error.message });
        res.status(500).json({ runId, error: error.message });
    }
});

// ==================== OAUTH ROUTES ====================

app.get('/oauth/gmail/start', async (req, res) => {
    const { state } = req.query;
    if (!state) return res.status(400).send('Missing state parameter');

    const authUrl = gmail.getAuthUrl(state);
    res.redirect(authUrl);
});

app.get('/oauth/gmail/callback', async (req, res) => {
    const { code, state, error } = req.query;

    if (error) return res.send(renderOAuthResult(false, 'gmail', error));
    if (!code || !state) return res.status(400).send('Missing code or state');

    try {
        await ensureInitialized();

        const session = await db.getSessionByOAuthState(state);
        if (!session) return res.status(400).send('Invalid or expired state');

        const tokens = await gmail.exchangeCodeForTokens(code);
        if (!tokens.refreshToken) {
            return res.send(renderOAuthResult(false, 'gmail', 'No refresh token received'));
        }

        await db.updateProviderCredentials(session.telegramChatId, 'gmail', {
            refreshToken: tokens.refreshToken,
            email: tokens.email
        });

        await bot.handleOAuthSuccess(session.telegramChatId, 'gmail', tokens.email);
        await db.updateSession(session.telegramChatId, { oauthState: null });

        res.send(renderOAuthResult(true, 'gmail', null, tokens.email));
    } catch (err) {
        logger.error('Gmail OAuth failed', { error: err.message });
        res.send(renderOAuthResult(false, 'gmail', err.message));
    }
});

app.get('/oauth/outlook/start', async (req, res) => {
    const { state } = req.query;
    if (!state) return res.status(400).send('Missing state parameter');

    const authUrl = outlook.getAuthUrl(state);
    res.redirect(authUrl);
});

app.get('/oauth/outlook/callback', async (req, res) => {
    const { code, state, error, error_description } = req.query;

    if (error) return res.send(renderOAuthResult(false, 'outlook', error_description || error));
    if (!code || !state) return res.status(400).send('Missing code or state');

    try {
        await ensureInitialized();

        const session = await db.getSessionByOAuthState(state);
        if (!session) return res.status(400).send('Invalid or expired state');

        const tokens = await outlook.exchangeCodeForTokens(code);
        if (!tokens.refreshToken) {
            return res.send(renderOAuthResult(false, 'outlook', 'No refresh token received'));
        }

        await db.updateProviderCredentials(session.telegramChatId, 'outlook', {
            refreshToken: tokens.refreshToken,
            email: tokens.email
        });

        await bot.handleOAuthSuccess(session.telegramChatId, 'outlook', tokens.email);
        await db.updateSession(session.telegramChatId, { oauthState: null });

        res.send(renderOAuthResult(true, 'outlook', null, tokens.email));
    } catch (err) {
        logger.error('Outlook OAuth failed', { error: err.message });
        res.send(renderOAuthResult(false, 'outlook', err.message));
    }
});

/**
 * Render OAuth result page
 */
function renderOAuthResult(success, provider, error = null, email = null) {
    const providerName = provider === 'gmail' ? 'Gmail' : 'Outlook';
    const emoji = success ? '✅' : '❌';
    const title = success ? 'Connection Successful!' : 'Connection Failed';
    const color = success ? '#22c55e' : '#ef4444';

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Mail Cron</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: rgba(255, 255, 255, 0.05);
      backdrop-filter: blur(10px);
      border-radius: 20px;
      padding: 40px;
      max-width: 400px;
      width: 100%;
      text-align: center;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .emoji { font-size: 64px; margin-bottom: 20px; }
    h1 { color: ${color}; margin-bottom: 10px; font-size: 24px; }
    .provider { color: #94a3b8; margin-bottom: 20px; }
    .email { 
      background: rgba(255, 255, 255, 0.1);
      padding: 12px 20px;
      border-radius: 10px;
      color: #e2e8f0;
      margin: 20px 0;
    }
    .error {
      background: rgba(239, 68, 68, 0.2);
      padding: 12px 20px;
      border-radius: 10px;
      color: #fca5a5;
      margin: 20px 0;
      font-size: 14px;
    }
    .message { color: #94a3b8; line-height: 1.6; }
    .close-hint { margin-top: 30px; color: #64748b; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="emoji">${emoji}</div>
    <h1>${title}</h1>
    <p class="provider">${providerName}</p>
    ${email ? `<div class="email">📧 ${email}</div>` : ''}
    ${error ? `<div class="error">⚠️ ${error}</div>` : ''}
    <p class="message">
      ${success
            ? 'Your account has been connected successfully. You can now close this window and return to Telegram.'
            : 'Something went wrong. Please return to Telegram and try again.'}
    </p>
    <p class="close-hint">You can close this window now</p>
  </div>
</body>
</html>`;
}

// ==================== DEBUG ROUTES ====================

app.get('/debug/stats', async (req, res) => {
    try {
        await ensureInitialized();
        const stats = await db.getStats();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== START SERVER ====================

// Only start server if not in serverless environment
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    app.listen(PORT, () => {
        logger.info('Server started', { port: PORT });
        logger.info(`Health: http://localhost:${PORT}/health`);
        logger.info(`Webhook setup: http://localhost:${PORT}/webhook/setup`);
        logger.info(`Cron: http://localhost:${PORT}/cron/check`);
    });
}

// Export for serverless
module.exports = app;
