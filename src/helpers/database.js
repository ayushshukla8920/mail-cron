/**
 * Database Helper
 * MongoDB connection and common database operations
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { User, Email, Session } = require('../models');

// Failure alert cooldown (2 hours in milliseconds)
const FAILURE_ALERT_COOLDOWN_MS = 2 * 60 * 60 * 1000;

/**
 * Connect to MongoDB
 * @returns {Promise<void>}
 */
async function connect() {
    try {
        const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/mail-cron';

        await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000
        });

        logger.info('Connected to MongoDB', { uri: uri.replace(/\/\/.*@/, '//***@') });
    } catch (error) {
        logger.error('MongoDB connection failed', { error: error.message });
        throw error;
    }
}

/**
 * Check if connected to MongoDB
 * @returns {boolean}
 */
function isConnected() {
    return mongoose.connection.readyState === 1;
}

// ==================== USER OPERATIONS ====================

/**
 * Find or create user by Telegram chat ID
 * @param {Object} telegramUser - Telegram user object
 * @returns {Promise<Object>} User document
 */
async function findOrCreateUser(telegramUser) {
    const chatId = telegramUser.id.toString();

    let user = await User.findOne({ telegramChatId: chatId });

    if (!user) {
        user = new User({
            telegramChatId: chatId,
            telegramUsername: telegramUser.username || null,
            firstName: telegramUser.first_name || 'User',
            lastName: telegramUser.last_name || null
        });
        await user.save();
        logger.info('New user created', { chatId, username: telegramUser.username });
    }

    return user;
}

/**
 * Get user by chat ID
 * @param {string} chatId - Telegram chat ID
 * @returns {Promise<Object|null>} User document or null
 */
async function getUserByChatId(chatId) {
    return User.findOne({ telegramChatId: chatId.toString() });
}

/**
 * Get all active users
 * @returns {Promise<Array>} Array of user documents
 */
async function getActiveUsers() {
    return User.find({
        isActive: true,
        $or: [
            { 'providers.gmail.enabled': true },
            { 'providers.outlook.enabled': true }
        ]
    });
}

/**
 * Update user's provider credentials
 * @param {string} chatId - Telegram chat ID
 * @param {string} provider - Provider name (gmail/outlook)
 * @param {Object} credentials - Provider credentials
 * @returns {Promise<Object>} Updated user
 */
async function updateProviderCredentials(chatId, provider, credentials) {
    const update = {
        [`providers.${provider}.enabled`]: true,
        [`providers.${provider}.refreshToken`]: credentials.refreshToken,
        [`providers.${provider}.email`]: credentials.email || null,
        [`providers.${provider}.connectedAt`]: new Date(),
        [`providers.${provider}.lastError`]: null,
        [`providers.${provider}.lastErrorAt`]: null
    };

    const user = await User.findOneAndUpdate(
        { telegramChatId: chatId.toString() },
        { $set: update },
        { new: true }
    );

    logger.info('Provider credentials updated', { chatId, provider });

    return user;
}

/**
 * Record provider error
 * @param {string} chatId - Telegram chat ID
 * @param {string} provider - Provider name
 * @param {string} error - Error message
 */
async function recordProviderError(chatId, provider, error) {
    await User.updateOne(
        { telegramChatId: chatId.toString() },
        {
            $set: {
                [`providers.${provider}.lastError`]: error,
                [`providers.${provider}.lastErrorAt`]: new Date()
            }
        }
    );
}

/**
 * Update last checked timestamp
 * @param {string} chatId - Telegram chat ID
 * @param {string} provider - Provider name
 */
async function updateLastChecked(chatId, provider) {
    await User.updateOne(
        { telegramChatId: chatId.toString() },
        { $set: { [`lastChecked.${provider}`]: new Date() } }
    );
}

/**
 * Check if failure alert can be sent (rate limiting)
 * @param {string} chatId - Telegram chat ID
 * @param {string} provider - Provider name
 * @returns {Promise<boolean>}
 */
async function canSendFailureAlert(chatId, provider) {
    const user = await getUserByChatId(chatId);
    if (!user) return false;

    const lastAlert = user.lastFailureAlert?.[provider];
    if (!lastAlert) return true;

    return (Date.now() - lastAlert.getTime()) >= FAILURE_ALERT_COOLDOWN_MS;
}

/**
 * Record failure alert sent
 * @param {string} chatId - Telegram chat ID
 * @param {string} provider - Provider name
 */
async function recordFailureAlert(chatId, provider) {
    await User.updateOne(
        { telegramChatId: chatId.toString() },
        { $set: { [`lastFailureAlert.${provider}`]: new Date() } }
    );
}

// ==================== EMAIL OPERATIONS ====================

/**
 * Check if email has been notified
 * @param {string} chatId - Telegram chat ID
 * @param {string} provider - Provider name
 * @param {string} messageId - Email message ID
 * @returns {Promise<boolean>}
 */
async function isEmailNotified(chatId, provider, messageId) {
    const email = await Email.findOne({
        telegramChatId: chatId.toString(),
        provider,
        messageId,
        notified: true
    });
    return !!email;
}

/**
 * Save email and mark as notified
 * @param {Object} user - User document
 * @param {Object} email - Email data
 * @param {Object} classification - Classification result
 * @returns {Promise<Object>} Saved email document
 */
async function saveEmail(user, email, classification) {
    const uniqueId = `${email.provider}_${email.messageId}`;

    const emailDoc = await Email.findOneAndUpdate(
        { uniqueId },
        {
            $setOnInsert: {
                userId: user._id,
                telegramChatId: user.telegramChatId,
                provider: email.provider,
                messageId: email.messageId,
                threadId: email.threadId || null,
                uniqueId,
                subject: email.subject,
                from: email.from,
                to: email.to,
                snippet: email.snippet,
                body: email.body,
                webLink: email.webLink,
                receivedAt: email.date,
                createdAt: new Date()
            },
            $set: {
                classification: {
                    important: classification.important,
                    category: classification.category,
                    confidence: classification.confidence,
                    reason: classification.reason,
                    method: classification.method
                },
                notified: true,
                notifiedAt: new Date()
            }
        },
        { upsert: true, new: true }
    );

    return emailDoc;
}

/**
 * Get user's email history
 * @param {string} chatId - Telegram chat ID
 * @param {Object} options - Query options
 * @returns {Promise<Array>}
 */
async function getUserEmails(chatId, options = {}) {
    const query = { telegramChatId: chatId.toString() };

    if (options.important !== undefined) {
        query['classification.important'] = options.important;
    }

    if (options.category) {
        query['classification.category'] = options.category;
    }

    return Email.find(query)
        .sort({ receivedAt: -1 })
        .limit(options.limit || 50);
}

// ==================== SESSION OPERATIONS ====================

/**
 * Get or create session for chat
 * @param {string} chatId - Telegram chat ID
 * @returns {Promise<Object>} Session document
 */
async function getOrCreateSession(chatId) {
    let session = await Session.findOne({ telegramChatId: chatId.toString() });

    if (!session) {
        session = new Session({
            telegramChatId: chatId.toString(),
            state: 'START'
        });
        await session.save();
    }

    return session;
}

/**
 * Update session state
 * @param {string} chatId - Telegram chat ID
 * @param {Object} updates - Updates to apply
 * @returns {Promise<Object>} Updated session
 */
async function updateSession(chatId, updates) {
    return Session.findOneAndUpdate(
        { telegramChatId: chatId.toString() },
        {
            $set: {
                ...updates,
                updatedAt: new Date(),
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
            }
        },
        { new: true, upsert: true }
    );
}

/**
 * Get session by OAuth state
 * @param {string} oauthState - OAuth state parameter
 * @returns {Promise<Object|null>}
 */
async function getSessionByOAuthState(oauthState) {
    return Session.findOne({ oauthState });
}

/**
 * Clear session
 * @param {string} chatId - Telegram chat ID
 */
async function clearSession(chatId) {
    await Session.deleteOne({ telegramChatId: chatId.toString() });
}

// ==================== STATS ====================

/**
 * Get database statistics
 * @returns {Promise<Object>}
 */
async function getStats() {
    const [userCount, activeUserCount, emailCount, importantEmailCount] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({
            isActive: true,
            $or: [
                { 'providers.gmail.enabled': true },
                { 'providers.outlook.enabled': true }
            ]
        }),
        Email.countDocuments(),
        Email.countDocuments({ 'classification.important': true })
    ]);

    return {
        users: userCount,
        activeUsers: activeUserCount,
        emails: emailCount,
        importantEmails: importantEmailCount
    };
}

module.exports = {
    connect,
    isConnected,
    // User operations
    findOrCreateUser,
    getUserByChatId,
    getActiveUsers,
    updateProviderCredentials,
    recordProviderError,
    updateLastChecked,
    canSendFailureAlert,
    recordFailureAlert,
    // Email operations
    isEmailNotified,
    saveEmail,
    getUserEmails,
    // Session operations
    getOrCreateSession,
    updateSession,
    getSessionByOAuthState,
    clearSession,
    // Stats
    getStats
};
