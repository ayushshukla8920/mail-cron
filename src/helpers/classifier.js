/**
 * Email Classifier
 * 2-level classification approach:
 * Level 1: Fast keyword scoring (always runs)
 * Level 2: Gemini AI classification (runs if uncertain)
 */

const axios = require('axios');
const logger = require('../utils/logger');

// Email categories
const CATEGORIES = {
    PLACEMENT_DRIVE: 'PLACEMENT_DRIVE',
    INTERVIEW: 'INTERVIEW',
    ASSESSMENT: 'ASSESSMENT',
    SHORTLISTED: 'SHORTLISTED',
    OTHER: 'OTHER'
};

// Keyword scoring configuration
const KEYWORD_SCORES = {
    // Placement Drive keywords
    PLACEMENT_DRIVE: {
        high: ['placement drive', 'campus placement', 'placement season', 'placement opportunity',
            'campus recruitment', 'recruitment drive', 'pool campus', 'off campus placement'],
        medium: ['placement', 'campus hiring', 'fresher hiring', 'batch hiring', 'graduate hiring'],
        low: ['career opportunity', 'job opportunity', 'hiring']
    },

    // Interview keywords
    INTERVIEW: {
        high: ['interview schedule', 'interview invitation', 'technical interview', 'hr interview',
            'interview round', 'interview slot', 'interview call', 'interview date',
            'join the interview', 'interview link', 'zoom interview', 'teams interview'],
        medium: ['interview', 'interviewing', 'face to face', 'video call', 'screening call'],
        low: ['discussion', 'meeting scheduled']
    },

    // Assessment keywords
    ASSESSMENT: {
        high: ['online assessment', 'coding test', 'aptitude test', 'technical test',
            'online test', 'assessment link', 'test invitation', 'hackerrank', 'hackerearth',
            'codility', 'mettl', 'amcat', 'cocubes', 'assessment invitation'],
        medium: ['assessment', 'test scheduled', 'exam link', 'proctored test', 'coding challenge'],
        low: ['test', 'quiz', 'evaluation']
    },

    // Shortlisted keywords
    SHORTLISTED: {
        high: ['you have been shortlisted', 'shortlisted for', 'congratulations you are shortlisted',
            'selected for next round', 'cleared the round', 'qualified for',
            'you are selected', 'offer letter', 'job offer', 'we are pleased to offer'],
        medium: ['shortlisted', 'selected', 'congratulations', 'next round', 'moved forward'],
        low: ['next steps', 'proceeding', 'qualifying']
    }
};

// Negative keywords (reduce score if present)
const NEGATIVE_KEYWORDS = [
    'unsubscribe', 'newsletter', 'marketing', 'promotional', 'sale', 'discount',
    'webinar registration', 'course enrollment', 'learn more', 'free trial'
];

// Sender patterns that boost confidence
const TRUSTED_SENDER_PATTERNS = [
    /hr@/i, /careers@/i, /recruitment@/i, /talent@/i, /hiring@/i,
    /noreply.*placement/i, /campus.*team/i, /@naukri\.com/i, /@linkedin\.com/i,
    /@monster\.com/i, /@indeed\.com/i, /@internshala\.com/i, /@hackerrank\.com/i,
    /@hackerearth\.com/i, /@codility\.com/i, /@mettl\.com/i
];

// Threshold for AI classification (if score is between these, use AI)
const AI_THRESHOLD_LOW = 3;
const AI_THRESHOLD_HIGH = 8;

/**
 * Classify email using 2-level approach
 * @param {Object} email - Email object with subject, body, from, snippet
 * @returns {Promise<Object>} Classification result
 */
async function classifyEmail(email) {
    // Level 1: Keyword scoring
    const keywordResult = keywordClassify(email);

    logger.debug('Keyword classification result', {
        emailId: email.id,
        category: keywordResult.category,
        score: keywordResult.score,
        important: keywordResult.important
    });

    // If confident enough, use keyword result directly
    if (keywordResult.score >= AI_THRESHOLD_HIGH || keywordResult.score <= AI_THRESHOLD_LOW) {
        return {
            important: keywordResult.important,
            category: keywordResult.category,
            confidence: Math.min(keywordResult.score / 10, 1.0),
            reason: keywordResult.reason,
            method: 'keyword'
        };
    }

    // Level 2: AI classification for uncertain cases
    if (process.env.GEMINI_API_KEY) {
        try {
            const aiResult = await aiClassify(email);
            return {
                ...aiResult,
                method: 'ai'
            };
        } catch (error) {
            logger.warn('AI classification failed, falling back to keyword', { error: error.message });
        }
    }

    // Fallback to keyword result
    return {
        important: keywordResult.important,
        category: keywordResult.category,
        confidence: Math.min(keywordResult.score / 10, 1.0),
        reason: keywordResult.reason,
        method: 'keyword_fallback'
    };
}

/**
 * Level 1: Keyword-based classification
 * @param {Object} email - Email object
 * @returns {Object} Classification result with score
 */
function keywordClassify(email) {
    const text = `${email.subject} ${email.snippet} ${email.body}`.toLowerCase();
    const from = (email.from || '').toLowerCase();

    // Check for negative keywords
    let negativeScore = 0;
    for (const keyword of NEGATIVE_KEYWORDS) {
        if (text.includes(keyword)) {
            negativeScore += 2;
        }
    }

    // Check for trusted senders
    let senderBonus = 0;
    for (const pattern of TRUSTED_SENDER_PATTERNS) {
        if (pattern.test(from)) {
            senderBonus = 3;
            break;
        }
    }

    // Score each category
    const categoryScores = {};
    let maxCategory = CATEGORIES.OTHER;
    let maxScore = 0;

    for (const [category, keywords] of Object.entries(KEYWORD_SCORES)) {
        let score = 0;
        const matchedKeywords = [];

        // High confidence keywords (3 points each)
        for (const kw of keywords.high) {
            if (text.includes(kw)) {
                score += 3;
                matchedKeywords.push(kw);
            }
        }

        // Medium confidence keywords (2 points each)
        for (const kw of keywords.medium) {
            if (text.includes(kw)) {
                score += 2;
                matchedKeywords.push(kw);
            }
        }

        // Low confidence keywords (1 point each)
        for (const kw of keywords.low) {
            if (text.includes(kw)) {
                score += 1;
                matchedKeywords.push(kw);
            }
        }

        // Apply sender bonus
        score += senderBonus;

        // Apply negative score
        score = Math.max(0, score - negativeScore);

        categoryScores[category] = { score, matchedKeywords };

        if (score > maxScore) {
            maxScore = score;
            maxCategory = category;
        }
    }

    // Determine if important (not OTHER and score above threshold)
    const important = maxCategory !== CATEGORIES.OTHER && maxScore >= 2;

    // Build reason
    const matchedKws = categoryScores[maxCategory]?.matchedKeywords || [];
    const reason = matchedKws.length > 0
        ? `Matched keywords: ${matchedKws.slice(0, 3).join(', ')}`
        : 'No strong keyword matches';

    return {
        important,
        category: maxCategory,
        score: maxScore,
        reason,
        categoryScores
    };
}

/**
 * Level 2: AI-based classification using Gemini
 * @param {Object} email - Email object
 * @returns {Promise<Object>} AI classification result
 */
async function aiClassify(email) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('Gemini API key not configured');
    }

    const prompt = buildAIPrompt(email);

    try {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
            {
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 256,
                    responseMimeType: 'application/json'
                }
            },
            {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );

        // Extract text from response
        const responseText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!responseText) {
            throw new Error('Empty response from Gemini');
        }

        // Parse JSON response
        const result = parseAIResponse(responseText);

        return result;
    } catch (error) {
        logger.error('Gemini API error', {
            error: error.response?.data?.error?.message || error.message
        });
        throw error;
    }
}

/**
 * Build AI prompt for classification
 * @param {Object} email - Email object
 * @returns {string} Prompt string
 */
function buildAIPrompt(email) {
    return `You are an email classifier for a college student. Analyze this email and determine if it's related to job placements or interviews.

EMAIL DETAILS:
From: ${email.from}
Subject: ${email.subject}
Content: ${email.snippet}

CATEGORIES:
- PLACEMENT_DRIVE: Campus placement announcements, recruitment drives
- INTERVIEW: Interview invitations, scheduling, rounds
- ASSESSMENT: Online tests, coding challenges, aptitude tests
- SHORTLISTED: Selection notifications, offer letters
- OTHER: Not related to placements/interviews

Respond with ONLY valid JSON in this exact format:
{
  "important": true or false,
  "category": "CATEGORY_NAME",
  "confidence": 0.0 to 1.0,
  "reason": "brief explanation"
}

Important emails are those in PLACEMENT_DRIVE, INTERVIEW, ASSESSMENT, or SHORTLISTED categories.`;
}

/**
 * Parse AI response with robust error handling
 * @param {string} responseText - Raw AI response
 * @returns {Object} Parsed classification result
 */
function parseAIResponse(responseText) {
    try {
        // Try direct JSON parse
        const result = JSON.parse(responseText);

        // Validate required fields
        if (typeof result.important !== 'boolean') {
            result.important = false;
        }

        if (!Object.values(CATEGORIES).includes(result.category)) {
            result.category = CATEGORIES.OTHER;
        }

        if (typeof result.confidence !== 'number' || result.confidence < 0 || result.confidence > 1) {
            result.confidence = 0.5;
        }

        if (typeof result.reason !== 'string') {
            result.reason = 'AI classification';
        }

        return result;
    } catch (parseError) {
        // Try to extract JSON from response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                return parseAIResponse(jsonMatch[0]);
            } catch (e) {
                // Fall through to default
            }
        }

        logger.warn('Failed to parse AI response', { responseText: responseText.substring(0, 200) });

        // Return default uncertain result
        return {
            important: false,
            category: CATEGORIES.OTHER,
            confidence: 0.0,
            reason: 'Failed to parse AI response'
        };
    }
}

module.exports = {
    classifyEmail,
    keywordClassify,
    CATEGORIES
};
