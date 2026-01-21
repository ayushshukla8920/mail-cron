/**
 * Telegram Bot Handler (Webhook Mode)
 * Handles user onboarding and interactive commands
 * Works with serverless platforms (Vercel, Netlify, etc.)
 */

const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
const logger = require('../utils/logger');
const db = require('./database');

let bot = null;

// ==================== BOT MESSAGES ====================
const MESSAGES = {
    WELCOME: `🎉 *Welcome to Mail Cron Bot!*

I'll help you stay on top of important placement and interview emails from your Gmail and Outlook accounts.

*How it works:*
1️⃣ Connect your email accounts
2️⃣ I'll check your inbox every 15 minutes
3️⃣ You'll get instant Telegram notifications for:
   • 🎓 Placement Drives
   • 🎤 Interview Invitations
   • 📝 Assessment Tests
   • 🎉 Shortlist Notifications

Let's get started! Which email provider would you like to connect first?`,

    CHOOSE_PROVIDER: `Which email provider would you like to connect?`,

    GMAIL_INSTRUCTIONS: `📧 *Connect Gmail*

Click the button below to authorize access to your Gmail account.

_Note: We only request read-only access to check for new emails._`,

    OUTLOOK_INSTRUCTIONS: `📧 *Connect Outlook*

Click the button below to authorize access to your Outlook account.

_Note: We only request read-only access to check for new emails._`,

    GMAIL_SUCCESS: `✅ *Gmail Connected Successfully!*

Your Gmail account has been linked. I'll now monitor it for important emails.

📧 Email: {email}`,

    OUTLOOK_SUCCESS: `✅ *Outlook Connected Successfully!*

Your Outlook account has been linked. I'll now monitor it for important emails.

📧 Email: {email}`,

    SETUP_COMPLETE: `🎊 *Setup Complete!*

Your email monitoring is now active. I'll notify you when important placement or interview emails arrive.

*Connected accounts:*
{accounts}

*Commands:*
/status - Check connection status
/settings - Manage notifications
/history - View recent important emails
/add - Connect another email account
/help - Show all commands`,

    ADD_ANOTHER: `Would you like to connect another email provider?`,

    ALREADY_CONNECTED: `⚠️ Your {provider} account is already connected.

Would you like to reconnect it with a different account?`,

    CONNECTION_FAILED: `❌ *Connection Failed*

Something went wrong while connecting your {provider} account.

Error: {error}

Please try again with /add command.`,

    STATUS: `📊 *Your Status*

{accounts}

*Last Check:*
{lastCheck}

*Statistics:*
📧 Total emails scanned: {emailCount}
🎯 Important emails found: {importantCount}`,

    HELP: `📚 *Available Commands*

*Setup*
/start - Start setup wizard
/add - Connect a new email account
/remove - Disconnect an email account

*Monitoring*
/status - Check connection status
/history - View recent important emails

*Settings*
/settings - Manage notification preferences
/pause - Pause notifications
/resume - Resume notifications

*Other*
/help - Show this help message`,

    NO_ACCOUNTS: `⚠️ You don't have any email accounts connected yet.

Use /start to begin setup.`,

    NOTIFICATIONS_PAUSED: `⏸️ Notifications have been paused.

Use /resume to re-enable notifications.`,

    NOTIFICATIONS_RESUMED: `▶️ Notifications have been resumed.

You'll now receive alerts for important emails.`,

    ERROR: `❌ An error occurred. Please try again later.`
};

// ==================== KEYBOARD LAYOUTS ====================
const KEYBOARDS = {
    PROVIDER_CHOICE: {
        inline_keyboard: [
            [
                { text: '📧 Gmail', callback_data: 'connect_gmail' },
                { text: '📧 Outlook', callback_data: 'connect_outlook' }
            ]
        ]
    },

    ADD_ANOTHER: {
        inline_keyboard: [
            [
                { text: '➕ Add Gmail', callback_data: 'connect_gmail' },
                { text: '➕ Add Outlook', callback_data: 'connect_outlook' }
            ],
            [
                { text: '✅ Done', callback_data: 'setup_done' }
            ]
        ]
    },

    RECONNECT: (provider) => ({
        inline_keyboard: [
            [
                { text: '🔄 Reconnect', callback_data: `reconnect_${provider}` },
                { text: '❌ Cancel', callback_data: 'cancel' }
            ]
        ]
    })
};

/**
 * Initialize Telegram bot in webhook mode
 * @returns {TelegramBot} Bot instance
 */
function initBot() {
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token) {
        throw new Error('TELEGRAM_BOT_TOKEN not configured');
    }

    // Create bot instance WITHOUT polling (webhook mode)
    bot = new TelegramBot(token, { polling: false });

    logger.info('Telegram bot initialized (webhook mode)');

    return bot;
}

/**
 * Get bot instance
 * @returns {TelegramBot}
 */
function getBot() {
    if (!bot) {
        initBot();
    }
    return bot;
}

/**
 * Process incoming webhook update
 * @param {Object} update - Telegram update object
 */
async function processUpdate(update) {
    try {
        const botInstance = getBot();

        // Handle message updates
        if (update.message) {
            await handleMessage(update.message);
        }

        // Handle callback query (button clicks)
        if (update.callback_query) {
            await handleCallbackQuery(update.callback_query);
        }
    } catch (error) {
        logger.error('Error processing update', { error: error.message, update });
    }
}

/**
 * Handle incoming messages
 * @param {Object} msg - Telegram message object
 */
async function handleMessage(msg) {
    const text = msg.text || '';
    const chatId = msg.chat.id;

    // Route commands
    if (text.startsWith('/start')) {
        await handleStart(msg);
    } else if (text.startsWith('/help')) {
        await handleHelp(msg);
    } else if (text.startsWith('/status')) {
        await handleStatus(msg);
    } else if (text.startsWith('/add')) {
        await handleAdd(msg);
    } else if (text.startsWith('/settings')) {
        await handleSettings(msg);
    } else if (text.startsWith('/pause')) {
        await handlePause(msg);
    } else if (text.startsWith('/resume')) {
        await handleResume(msg);
    } else if (text.startsWith('/history')) {
        await handleHistory(msg);
    }
    // Ignore non-command messages
}

// ==================== COMMAND HANDLERS ====================

/**
 * Handle /start command
 */
async function handleStart(msg) {
    const chatId = msg.chat.id;
    const botInstance = getBot();

    try {
        // Create or get user
        await db.findOrCreateUser(msg.from);

        // Update session
        await db.updateSession(chatId.toString(), {
            state: 'AWAITING_PROVIDER_CHOICE'
        });

        // Send welcome message
        await botInstance.sendMessage(chatId, MESSAGES.WELCOME, {
            parse_mode: 'Markdown',
            reply_markup: KEYBOARDS.PROVIDER_CHOICE
        });
    } catch (error) {
        logger.error('Error in /start handler', { error: error.message, chatId });
        await botInstance.sendMessage(chatId, MESSAGES.ERROR);
    }
}

/**
 * Handle /help command
 */
async function handleHelp(msg) {
    const chatId = msg.chat.id;
    const botInstance = getBot();
    await botInstance.sendMessage(chatId, MESSAGES.HELP, { parse_mode: 'Markdown' });
}

/**
 * Handle /status command
 */
async function handleStatus(msg) {
    const chatId = msg.chat.id;
    const botInstance = getBot();

    try {
        const user = await db.getUserByChatId(chatId.toString());

        if (!user) {
            await botInstance.sendMessage(chatId, MESSAGES.NO_ACCOUNTS);
            return;
        }

        // Build accounts status
        const accounts = [];
        if (user.providers.gmail.enabled) {
            accounts.push(`✅ Gmail: ${user.providers.gmail.email || 'Connected'}`);
        } else {
            accounts.push('❌ Gmail: Not connected');
        }

        if (user.providers.outlook.enabled) {
            accounts.push(`✅ Outlook: ${user.providers.outlook.email || 'Connected'}`);
        } else {
            accounts.push('❌ Outlook: Not connected');
        }

        // Get email stats
        const emails = await db.getUserEmails(chatId.toString(), { limit: 1000 });
        const importantEmails = emails.filter(e => e.classification.important);

        // Build last check info
        const lastChecks = [];
        if (user.lastChecked.gmail) {
            lastChecks.push(`Gmail: ${formatTimeAgo(user.lastChecked.gmail)}`);
        }
        if (user.lastChecked.outlook) {
            lastChecks.push(`Outlook: ${formatTimeAgo(user.lastChecked.outlook)}`);
        }

        const statusMessage = MESSAGES.STATUS
            .replace('{accounts}', accounts.join('\n'))
            .replace('{lastCheck}', lastChecks.join('\n') || 'Never')
            .replace('{emailCount}', emails.length.toString())
            .replace('{importantCount}', importantEmails.length.toString());

        await botInstance.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
    } catch (error) {
        logger.error('Error in /status handler', { error: error.message, chatId });
        await botInstance.sendMessage(chatId, MESSAGES.ERROR);
    }
}

/**
 * Handle /add command
 */
async function handleAdd(msg) {
    const chatId = msg.chat.id;
    const botInstance = getBot();

    try {
        await db.findOrCreateUser(msg.from);

        await db.updateSession(chatId.toString(), {
            state: 'AWAITING_PROVIDER_CHOICE'
        });

        await botInstance.sendMessage(chatId, MESSAGES.CHOOSE_PROVIDER, {
            parse_mode: 'Markdown',
            reply_markup: KEYBOARDS.PROVIDER_CHOICE
        });
    } catch (error) {
        logger.error('Error in /add handler', { error: error.message, chatId });
        await botInstance.sendMessage(chatId, MESSAGES.ERROR);
    }
}

/**
 * Handle /settings command
 */
async function handleSettings(msg) {
    const chatId = msg.chat.id;
    const botInstance = getBot();

    try {
        const user = await db.getUserByChatId(chatId.toString());

        if (!user) {
            await botInstance.sendMessage(chatId, MESSAGES.NO_ACCOUNTS);
            return;
        }

        const settings = user.settings;
        const statusEmoji = settings.notificationsEnabled ? '✅' : '❌';

        const categories = Object.entries(settings.categories)
            .map(([cat, enabled]) => `${enabled ? '✅' : '❌'} ${cat.replace(/_/g, ' ')}`)
            .join('\n');

        const message = `⚙️ *Notification Settings*

*Status:* ${statusEmoji} ${settings.notificationsEnabled ? 'Enabled' : 'Disabled'}

*Categories:*
${categories}

Use /pause or /resume to toggle notifications.`;

        await botInstance.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
        logger.error('Error in /settings handler', { error: error.message, chatId });
        await botInstance.sendMessage(chatId, MESSAGES.ERROR);
    }
}

/**
 * Handle /pause command
 */
async function handlePause(msg) {
    const chatId = msg.chat.id;
    const botInstance = getBot();

    try {
        const { User } = require('../models');
        await User.updateOne(
            { telegramChatId: chatId.toString() },
            { $set: { 'settings.notificationsEnabled': false } }
        );

        await botInstance.sendMessage(chatId, MESSAGES.NOTIFICATIONS_PAUSED, { parse_mode: 'Markdown' });
    } catch (error) {
        logger.error('Error in /pause handler', { error: error.message, chatId });
        await botInstance.sendMessage(chatId, MESSAGES.ERROR);
    }
}

/**
 * Handle /resume command
 */
async function handleResume(msg) {
    const chatId = msg.chat.id;
    const botInstance = getBot();

    try {
        const { User } = require('../models');
        await User.updateOne(
            { telegramChatId: chatId.toString() },
            { $set: { 'settings.notificationsEnabled': true } }
        );

        await botInstance.sendMessage(chatId, MESSAGES.NOTIFICATIONS_RESUMED, { parse_mode: 'Markdown' });
    } catch (error) {
        logger.error('Error in /resume handler', { error: error.message, chatId });
        await botInstance.sendMessage(chatId, MESSAGES.ERROR);
    }
}

/**
 * Handle /history command
 */
async function handleHistory(msg) {
    const chatId = msg.chat.id;
    const botInstance = getBot();

    try {
        const emails = await db.getUserEmails(chatId.toString(), {
            important: true,
            limit: 10
        });

        if (emails.length === 0) {
            await botInstance.sendMessage(chatId, '📭 No important emails found yet.');
            return;
        }

        let message = '📧 *Recent Important Emails*\n\n';

        for (const email of emails) {
            const emoji = getCategoryEmoji(email.classification.category);
            const date = formatTimeAgo(email.receivedAt);

            message += `${emoji} *${email.classification.category.replace(/_/g, ' ')}*\n`;
            message += `📌 ${escapeMarkdown(truncate(email.subject, 50))}\n`;
            message += `👤 ${escapeMarkdown(truncate(email.from, 30))}\n`;
            message += `🕐 ${date}\n\n`;
        }

        await botInstance.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
        logger.error('Error in /history handler', { error: error.message, chatId });
        await botInstance.sendMessage(chatId, MESSAGES.ERROR);
    }
}

// ==================== CALLBACK HANDLERS ====================

/**
 * Handle inline button callbacks
 */
async function handleCallbackQuery(query) {
    const chatId = query.message.chat.id;
    const data = query.data;
    const botInstance = getBot();

    try {
        // Acknowledge callback
        await botInstance.answerCallbackQuery(query.id);

        switch (data) {
            case 'connect_gmail':
                await initiateOAuth(chatId, 'gmail');
                break;

            case 'connect_outlook':
                await initiateOAuth(chatId, 'outlook');
                break;

            case 'reconnect_gmail':
                await initiateOAuth(chatId, 'gmail', true);
                break;

            case 'reconnect_outlook':
                await initiateOAuth(chatId, 'outlook', true);
                break;

            case 'setup_done':
                await handleSetupComplete(chatId);
                break;

            case 'cancel':
                await botInstance.sendMessage(chatId, '👍 Cancelled.');
                break;

            default:
                logger.warn('Unknown callback data', { data, chatId });
        }
    } catch (error) {
        logger.error('Error in callback handler', { error: error.message, data, chatId });
        await botInstance.sendMessage(chatId, MESSAGES.ERROR);
    }
}

// ==================== OAUTH FLOW ====================

/**
 * Initiate OAuth flow for a provider
 */
async function initiateOAuth(chatId, provider, reconnect = false) {
    const botInstance = getBot();

    try {
        const user = await db.getUserByChatId(chatId.toString());

        // Check if already connected
        if (!reconnect && user?.providers?.[provider]?.enabled) {
            const message = MESSAGES.ALREADY_CONNECTED.replace('{provider}', provider);
            await botInstance.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: KEYBOARDS.RECONNECT(provider)
            });
            return;
        }

        // Generate OAuth state for security
        const oauthState = crypto.randomBytes(16).toString('hex');

        // Save state to session
        await db.updateSession(chatId.toString(), {
            state: provider === 'gmail' ? 'AWAITING_GMAIL_AUTH' : 'AWAITING_OUTLOOK_AUTH',
            pendingProvider: provider,
            oauthState: oauthState
        });

        // Generate auth URL
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        const authUrl = `${baseUrl}/oauth/${provider}/start?state=${oauthState}`;

        const message = provider === 'gmail' ? MESSAGES.GMAIL_INSTRUCTIONS : MESSAGES.OUTLOOK_INSTRUCTIONS;

        await botInstance.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: `🔐 Authorize ${provider === 'gmail' ? 'Gmail' : 'Outlook'}`, url: authUrl }]
                ]
            }
        });
    } catch (error) {
        logger.error('Error initiating OAuth', { error: error.message, chatId, provider });
        throw error;
    }
}

/**
 * Handle successful OAuth callback
 */
async function handleOAuthSuccess(chatId, provider, email) {
    const botInstance = getBot();

    try {
        // Update session
        if (provider === 'gmail') {
            await db.updateSession(chatId, { gmailConnected: true });
        } else {
            await db.updateSession(chatId, { outlookConnected: true });
        }

        // Send success message
        const message = (provider === 'gmail' ? MESSAGES.GMAIL_SUCCESS : MESSAGES.OUTLOOK_SUCCESS)
            .replace('{email}', email || 'Unknown');

        await botInstance.sendMessage(chatId, message, { parse_mode: 'Markdown' });

        // Ask about adding another account
        await botInstance.sendMessage(chatId, MESSAGES.ADD_ANOTHER, {
            parse_mode: 'Markdown',
            reply_markup: KEYBOARDS.ADD_ANOTHER
        });

        logger.info('OAuth success handled', { chatId, provider, email });
    } catch (error) {
        logger.error('Error handling OAuth success', { error: error.message, chatId, provider });
        throw error;
    }
}

/**
 * Handle OAuth failure
 */
async function handleOAuthFailure(chatId, provider, error) {
    const botInstance = getBot();

    const message = MESSAGES.CONNECTION_FAILED
        .replace('{provider}', provider)
        .replace('{error}', error);

    await botInstance.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}

/**
 * Handle setup complete
 */
async function handleSetupComplete(chatId) {
    const botInstance = getBot();

    try {
        const user = await db.getUserByChatId(chatId.toString());

        const accounts = [];
        if (user?.providers?.gmail?.enabled) {
            accounts.push(`✅ Gmail: ${user.providers.gmail.email || 'Connected'}`);
        }
        if (user?.providers?.outlook?.enabled) {
            accounts.push(`✅ Outlook: ${user.providers.outlook.email || 'Connected'}`);
        }

        if (accounts.length === 0) {
            accounts.push('⚠️ No accounts connected');
        }

        const message = MESSAGES.SETUP_COMPLETE.replace('{accounts}', accounts.join('\n'));

        await botInstance.sendMessage(chatId, message, { parse_mode: 'Markdown' });

        // Clear session
        await db.updateSession(chatId.toString(), { state: 'IDLE' });
    } catch (error) {
        logger.error('Error completing setup', { error: error.message, chatId });
        await botInstance.sendMessage(chatId, MESSAGES.ERROR);
    }
}

// ==================== NOTIFICATION SENDING ====================

/**
 * Send email notification to user
 */
async function sendEmailNotification(chatId, email, classification) {
    const botInstance = getBot();

    try {
        const emoji = getCategoryEmoji(classification.category);
        const formattedDate = formatDate(email.date);

        const message = `${emoji} *${classification.category.replace(/_/g, ' ')}*

📧 *Subject:* ${escapeMarkdown(email.subject)}

👤 *From:* ${escapeMarkdown(truncate(email.from, 50))}

🕐 *Time:* ${formattedDate}

📝 *Preview:*
${escapeMarkdown(truncate(email.snippet, 200))}

🔗 [Open Email](${email.webLink})

_Confidence: ${Math.round(classification.confidence * 100)}%_`;

        await botInstance.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true
        });

        logger.info('Email notification sent', { chatId, emailId: email.id, category: classification.category });
        return true;
    } catch (error) {
        logger.error('Failed to send email notification', { chatId, error: error.message });
        return false;
    }
}

/**
 * Send failure alert to user
 */
async function sendFailureAlert(chatId, provider, error = '') {
    const botInstance = getBot();

    try {
        const providerName = provider === 'gmail' ? 'Gmail' : 'Outlook';

        const message = `⚠️ *Mail Fetch Failing*

The ${providerName} mail fetch is encountering errors. Please check your connection.

${error ? `_Error: ${escapeMarkdown(truncate(error, 100))}_` : ''}

Use /add to reconnect your ${providerName} account.

_This alert won't repeat for 2 hours._`;

        await botInstance.sendMessage(chatId, message, {
            parse_mode: 'Markdown'
        });

        return true;
    } catch (err) {
        logger.error('Failed to send failure alert', { chatId, provider, error: err.message });
        return false;
    }
}

// ==================== WEBHOOK MANAGEMENT ====================

/**
 * Set webhook URL with Telegram
 * @param {string} webhookUrl - Full URL to webhook endpoint
 */
async function setWebhook(webhookUrl) {
    const botInstance = getBot();

    try {
        const result = await botInstance.setWebHook(webhookUrl, {
            drop_pending_updates: true
        });

        logger.info('Webhook set successfully', { url: webhookUrl, result });
        return result;
    } catch (error) {
        logger.error('Failed to set webhook', { error: error.message });
        throw error;
    }
}

/**
 * Delete webhook (revert to polling mode)
 */
async function deleteWebhook() {
    const botInstance = getBot();

    try {
        const result = await botInstance.deleteWebHook();
        logger.info('Webhook deleted', { result });
        return result;
    } catch (error) {
        logger.error('Failed to delete webhook', { error: error.message });
        throw error;
    }
}

/**
 * Get current webhook info
 */
async function getWebhookInfo() {
    const botInstance = getBot();
    return botInstance.getWebHookInfo();
}

// ==================== UTILITY FUNCTIONS ====================

function getCategoryEmoji(category) {
    const emojis = {
        PLACEMENT_DRIVE: '🎓',
        INTERVIEW: '🎤',
        ASSESSMENT: '📝',
        SHORTLISTED: '🎉',
        OTHER: '📧'
    };
    return emojis[category] || '📧';
}

function formatDate(date) {
    if (!date) return 'Unknown';
    try {
        return new Date(date).toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return 'Unknown';
    }
}

function formatTimeAgo(date) {
    if (!date) return 'Never';

    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
}

function escapeMarkdown(text) {
    if (!text) return '';
    return text
        .replace(/\*/g, '\\*')
        .replace(/_/g, '\\_')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')
        .replace(/`/g, '\\`');
}

function truncate(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
}

module.exports = {
    initBot,
    getBot,
    processUpdate,
    handleOAuthSuccess,
    handleOAuthFailure,
    sendEmailNotification,
    sendFailureAlert,
    setWebhook,
    deleteWebhook,
    getWebhookInfo
};
