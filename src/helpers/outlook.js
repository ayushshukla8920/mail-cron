/**
 * Outlook Helper
 * Handles OAuth token refresh and fetching emails from Microsoft Graph API
 * Fetches from both Inbox and Junk Email folders
 */

const axios = require('axios');
const logger = require('../utils/logger');

// Microsoft Graph API base URL
const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

/**
 * Get token endpoint URL
 * @returns {string}
 */
function getTokenEndpoint() {
    const tenant = process.env.OUTLOOK_TENANT_ID || 'common';
    return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
}

/**
 * Get authorize endpoint URL
 * @returns {string}
 */
function getAuthorizeEndpoint() {
    const tenant = process.env.OUTLOOK_TENANT_ID || 'common';
    return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`;
}

/**
 * Get redirect URI
 * @returns {string}
 */
function getRedirectUri() {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    return `${baseUrl}/oauth/outlook/callback`;
}

/**
 * Generate authorization URL
 * @param {string} state - State parameter for CSRF protection
 * @returns {string} Authorization URL
 */
function getAuthUrl(state = '') {
    const params = new URLSearchParams({
        client_id: process.env.OUTLOOK_CLIENT_ID,
        response_type: 'code',
        redirect_uri: getRedirectUri(),
        scope: 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read offline_access',
        response_mode: 'query',
        state: state
    });

    return `${getAuthorizeEndpoint()}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 * @param {string} code - Authorization code from OAuth callback
 * @returns {Promise<Object>} Tokens and user info
 */
async function exchangeCodeForTokens(code) {
    const response = await axios.post(getTokenEndpoint(), new URLSearchParams({
        client_id: process.env.OUTLOOK_CLIENT_ID,
        client_secret: process.env.OUTLOOK_CLIENT_SECRET,
        code: code,
        redirect_uri: getRedirectUri(),
        grant_type: 'authorization_code'
    }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    // Get user email
    const userResponse = await axios.get(`${GRAPH_API_BASE}/me`, {
        headers: { 'Authorization': `Bearer ${response.data.access_token}` }
    });

    return {
        refreshToken: response.data.refresh_token,
        accessToken: response.data.access_token,
        email: userResponse.data.mail || userResponse.data.userPrincipalName
    };
}

/**
 * Get access token using refresh token
 * @param {string} refreshToken - User's refresh token
 * @returns {Promise<string>} Access token
 */
async function getAccessToken(refreshToken) {
    if (!refreshToken) {
        throw new Error('No refresh token provided');
    }

    const response = await axios.post(getTokenEndpoint(), new URLSearchParams({
        client_id: process.env.OUTLOOK_CLIENT_ID,
        client_secret: process.env.OUTLOOK_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: 'https://graph.microsoft.com/Mail.Read offline_access'
    }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    return response.data.access_token;
}

/**
 * Fetch emails from Outlook for a user (Inbox + Junk)
 * @param {string} refreshToken - User's Outlook refresh token
 * @param {number} sinceTimestamp - Fetch emails after this timestamp (ms)
 * @returns {Promise<Array>} Array of email objects
 */
async function fetchEmails(refreshToken, sinceTimestamp) {
    const accessToken = await getAccessToken(refreshToken);

    // Format date for Graph API filter
    const sinceDate = new Date(sinceTimestamp).toISOString();

    logger.debug('Outlook query', { since: sinceDate });

    const allEmails = [];

    // Fetch from Inbox
    try {
        const inboxEmails = await fetchFromFolder(accessToken, 'inbox', sinceDate);
        allEmails.push(...inboxEmails);
        logger.info(`Found ${inboxEmails.length} emails from Outlook Inbox`);
    } catch (error) {
        logger.error('Failed to fetch Outlook Inbox', { error: error.message });
    }

    // Fetch from Junk Email (Spam)
    try {
        const junkEmails = await fetchFromFolder(accessToken, 'junkemail', sinceDate);
        // Mark junk emails so we can flag them in notification
        junkEmails.forEach(email => {
            email.isSpam = true;
        });
        allEmails.push(...junkEmails);
        if (junkEmails.length > 0) {
            logger.info(`Found ${junkEmails.length} emails from Outlook Junk`);
        }
    } catch (error) {
        logger.warn('Failed to fetch Outlook Junk', { error: error.message });
    }

    return allEmails;
}

/**
 * Fetch emails from a specific folder
 * @param {string} accessToken - Access token
 * @param {string} folderName - Folder name (inbox, junkemail, etc.)
 * @param {string} sinceDate - ISO date string
 * @returns {Promise<Array>} Array of email objects
 */
async function fetchFromFolder(accessToken, folderName, sinceDate) {
    const filter = `receivedDateTime ge ${sinceDate}`;

    const response = await axios.get(`${GRAPH_API_BASE}/me/mailFolders/${folderName}/messages`, {
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        params: {
            '$filter': filter,
            '$top': 50,
            '$orderby': 'receivedDateTime desc',
            '$select': 'id,subject,from,toRecipients,receivedDateTime,bodyPreview,body,webLink,isRead,conversationId,parentFolderId'
        }
    });

    const messages = response.data.value || [];

    if (messages.length === 0) {
        return [];
    }

    // Parse messages
    const emails = messages.map(msg => parseOutlookMessage(msg, folderName === 'junkemail')).filter(Boolean);

    return emails;
}

/**
 * Parse Outlook message into standardized email object
 * @param {Object} message - Graph API message object
 * @param {boolean} isJunk - Whether the message is from junk folder
 * @returns {Object} Standardized email object
 */
function parseOutlookMessage(message, isJunk = false) {
    try {
        // Extract sender
        const from = message.from?.emailAddress
            ? `${message.from.emailAddress.name || ''} <${message.from.emailAddress.address}>`
            : 'Unknown Sender';

        // Extract recipients
        const to = (message.toRecipients || [])
            .map(r => r.emailAddress?.address)
            .filter(Boolean)
            .join(', ');

        // Get body content
        let body = message.bodyPreview || '';
        if (message.body?.content) {
            if (message.body.contentType === 'html') {
                body = message.body.content
                    .replace(/<[^>]*>/g, ' ')
                    .replace(/&nbsp;/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
            } else {
                body = message.body.content;
            }
        }

        return {
            id: `outlook_${message.id}`,
            provider: 'outlook',
            messageId: message.id,
            threadId: message.conversationId || null,
            subject: message.subject || '(No Subject)',
            from: from,
            to: to,
            date: new Date(message.receivedDateTime),
            snippet: (message.bodyPreview || '').substring(0, 300),
            body: body.substring(0, 2000),
            webLink: message.webLink || `https://outlook.office.com/mail/inbox/id/${message.id}`,
            isRead: message.isRead,
            isSpam: isJunk
        };
    } catch (error) {
        logger.warn('Failed to parse Outlook message', { error: error.message });
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
        const accessToken = await getAccessToken(refreshToken);
        await axios.get(`${GRAPH_API_BASE}/me`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        return true;
    } catch (error) {
        logger.error('Outlook connection test failed', { error: error.message });
        return false;
    }
}

module.exports = {
    getAuthUrl,
    exchangeCodeForTokens,
    fetchEmails,
    testConnection
};
