/**
 * Gmail Helper
 * Handles OAuth token refresh and fetching emails from Gmail API
 * Fetches from both Inbox and Spam folders
 */

const { google } = require('googleapis');
const logger = require('../utils/logger');

/**
 * Create OAuth2 client with credentials
 * @param {string} redirectUri - Optional custom redirect URI
 * @returns {google.auth.OAuth2} OAuth2 client
 */
function createOAuth2Client(redirectUri = null) {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

    return new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET,
        redirectUri || `${baseUrl}/oauth/gmail/callback`
    );
}

/**
 * Get access token using refresh token
 * @param {string} refreshToken - User's refresh token
 * @returns {Promise<google.auth.OAuth2>} Authenticated OAuth2 client
 */
async function getAuthenticatedClient(refreshToken) {
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({
        refresh_token: refreshToken
    });

    // Force token refresh to ensure we have a valid access token
    await oauth2Client.getAccessToken();

    return oauth2Client;
}

/**
 * Generate authorization URL
 * @param {string} state - State parameter for CSRF protection
 * @returns {string} Authorization URL
 */
function getAuthUrl(state = '') {
    const oauth2Client = createOAuth2Client();

    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/userinfo.email'
        ],
        prompt: 'consent', // Force consent to get refresh token
        state: state
    });
}

/**
 * Exchange authorization code for tokens
 * @param {string} code - Authorization code from OAuth callback
 * @returns {Promise<Object>} Tokens and user info
 */
async function exchangeCodeForTokens(code) {
    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    // Get user email
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    return {
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
        email: userInfo.data.email
    };
}

/**
 * Fetch emails from Gmail for a user (Inbox + Spam)
 * @param {string} refreshToken - User's Gmail refresh token
 * @param {number} sinceTimestamp - Fetch emails after this timestamp (ms)
 * @returns {Promise<Array>} Array of email objects
 */
async function fetchEmails(refreshToken, sinceTimestamp) {
    if (!refreshToken) {
        throw new Error('No refresh token provided');
    }

    const auth = await getAuthenticatedClient(refreshToken);
    const gmail = google.gmail({ version: 'v1', auth });

    // Calculate the "after" date for Gmail query (seconds)
    const afterDate = Math.floor(sinceTimestamp / 1000);

    logger.debug('Gmail query', { since: new Date(sinceTimestamp).toISOString() });

    const allEmails = [];

    // Fetch from Inbox (default query)
    try {
        const inboxEmails = await fetchFromLabel(gmail, afterDate, null);
        allEmails.push(...inboxEmails);
        logger.info(`Found ${inboxEmails.length} emails from Gmail Inbox`);
    } catch (error) {
        logger.error('Failed to fetch Gmail Inbox', { error: error.message });
    }

    // Fetch from Spam folder
    try {
        const spamEmails = await fetchFromLabel(gmail, afterDate, 'SPAM');
        // Mark spam emails so we can flag them in notification
        spamEmails.forEach(email => {
            email.isSpam = true;
        });
        allEmails.push(...spamEmails);
        if (spamEmails.length > 0) {
            logger.info(`Found ${spamEmails.length} emails from Gmail Spam`);
        }
    } catch (error) {
        logger.warn('Failed to fetch Gmail Spam', { error: error.message });
    }

    return allEmails;
}

/**
 * Fetch emails from a specific label/folder
 * @param {Object} gmail - Gmail API client
 * @param {number} afterDate - Unix timestamp in seconds
 * @param {string|null} labelId - Label ID (null for default search)
 * @returns {Promise<Array>} Array of email objects
 */
async function fetchFromLabel(gmail, afterDate, labelId) {
    const query = `after:${afterDate}`;

    const listParams = {
        userId: 'me',
        q: query,
        maxResults: 50
    };

    // If specific label requested, add it
    if (labelId) {
        listParams.labelIds = [labelId];
    }

    // List messages matching the query
    const listResponse = await gmail.users.messages.list(listParams);

    const messages = listResponse.data.messages || [];

    if (messages.length === 0) {
        return [];
    }

    // Fetch full message details
    const emails = [];

    for (const message of messages) {
        try {
            const msgResponse = await gmail.users.messages.get({
                userId: 'me',
                id: message.id,
                format: 'full'
            });

            const email = parseGmailMessage(msgResponse.data);
            if (email) {
                emails.push(email);
            }
        } catch (err) {
            logger.warn(`Failed to fetch Gmail message ${message.id}`, { error: err.message });
        }
    }

    return emails;
}

/**
 * Parse Gmail message into standardized email object
 * @param {Object} message - Gmail API message object
 * @returns {Object} Standardized email object
 */
function parseGmailMessage(message) {
    try {
        const headers = message.payload?.headers || [];

        const getHeader = (name) => {
            const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
            return header?.value || '';
        };

        // Extract snippet
        let snippet = message.snippet || '';

        // Try to get body
        let body = '';
        if (message.payload?.body?.data) {
            body = Buffer.from(message.payload.body.data, 'base64').toString('utf-8');
        } else if (message.payload?.parts) {
            const textPart = message.payload.parts.find(p => p.mimeType === 'text/plain');
            const htmlPart = message.payload.parts.find(p => p.mimeType === 'text/html');

            const part = textPart || htmlPart;
            if (part?.body?.data) {
                body = Buffer.from(part.body.data, 'base64').toString('utf-8');
                if (part.mimeType === 'text/html') {
                    body = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                }
            }
        }

        // Parse date
        const dateStr = getHeader('date');
        const timestamp = dateStr ? new Date(dateStr).getTime() : parseInt(message.internalDate);

        // Check if email is in spam
        const isSpam = (message.labelIds || []).includes('SPAM');

        return {
            id: `gmail_${message.id}`,
            provider: 'gmail',
            messageId: message.id,
            threadId: message.threadId,
            subject: getHeader('subject') || '(No Subject)',
            from: getHeader('from'),
            to: getHeader('to'),
            date: new Date(timestamp || Date.now()),
            snippet: snippet.substring(0, 300),
            body: body.substring(0, 2000),
            webLink: `https://mail.google.com/mail/u/0/#inbox/${message.id}`,
            labels: message.labelIds || [],
            isSpam: isSpam
        };
    } catch (error) {
        logger.warn('Failed to parse Gmail message', { error: error.message });
        return null;
    }
}

/**
 * Test connection with refresh token
 * @param {string} refreshToken - Refresh token to test
 * @returns {Promise<boolean>} True if connection works
 */
async function testConnection(refreshToken) {
    try {
        const auth = await getAuthenticatedClient(refreshToken);
        const gmail = google.gmail({ version: 'v1', auth });

        await gmail.users.getProfile({ userId: 'me' });
        return true;
    } catch (error) {
        logger.error('Gmail connection test failed', { error: error.message });
        return false;
    }
}

module.exports = {
    getAuthUrl,
    exchangeCodeForTokens,
    fetchEmails,
    testConnection
};
