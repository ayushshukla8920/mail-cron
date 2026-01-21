/**
 * MongoDB Models
 * Defines schemas for Users, Emails, and Sessions
 */

const mongoose = require('mongoose');

// ==================== USER SCHEMA ====================
const userSchema = new mongoose.Schema({
  // Telegram info
  telegramChatId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  telegramUsername: {
    type: String,
    default: null
  },
  firstName: {
    type: String,
    default: 'User'
  },
  lastName: {
    type: String,
    default: null
  },
  
  // Email provider configurations
  providers: {
    gmail: {
      enabled: { type: Boolean, default: false },
      refreshToken: { type: String, default: null },
      email: { type: String, default: null },
      connectedAt: { type: Date, default: null },
      lastError: { type: String, default: null },
      lastErrorAt: { type: Date, default: null }
    },
    outlook: {
      enabled: { type: Boolean, default: false },
      refreshToken: { type: String, default: null },
      email: { type: String, default: null },
      connectedAt: { type: Date, default: null },
      lastError: { type: String, default: null },
      lastErrorAt: { type: Date, default: null }
    }
  },
  
  // Notification settings
  settings: {
    notificationsEnabled: { type: Boolean, default: true },
    categories: {
      PLACEMENT_DRIVE: { type: Boolean, default: true },
      INTERVIEW: { type: Boolean, default: true },
      ASSESSMENT: { type: Boolean, default: true },
      SHORTLISTED: { type: Boolean, default: true }
    }
  },
  
  // Tracking
  lastChecked: {
    gmail: { type: Date, default: null },
    outlook: { type: Date, default: null }
  },
  lastFailureAlert: {
    gmail: { type: Date, default: null },
    outlook: { type: Date, default: null }
  },
  
  // Status
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Update timestamp on save
userSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// ==================== EMAIL SCHEMA ====================
const emailSchema = new mongoose.Schema({
  // Reference to user
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  telegramChatId: {
    type: String,
    required: true,
    index: true
  },
  
  // Email identification
  provider: {
    type: String,
    enum: ['gmail', 'outlook'],
    required: true
  },
  messageId: {
    type: String,
    required: true
  },
  threadId: {
    type: String,
    default: null
  },
  
  // Composite unique index
  uniqueId: {
    type: String,
    required: true,
    unique: true // provider_messageId
  },
  
  // Email content
  subject: { type: String, default: '(No Subject)' },
  from: { type: String, default: 'Unknown' },
  to: { type: String, default: null },
  snippet: { type: String, default: '' },
  body: { type: String, default: '' },
  webLink: { type: String, default: null },
  receivedAt: { type: Date, required: true },
  
  // Classification
  classification: {
    important: { type: Boolean, default: false },
    category: {
      type: String,
      enum: ['PLACEMENT_DRIVE', 'INTERVIEW', 'ASSESSMENT', 'SHORTLISTED', 'OTHER'],
      default: 'OTHER'
    },
    confidence: { type: Number, default: 0 },
    reason: { type: String, default: '' },
    method: { type: String, default: 'keyword' }
  },
  
  // Notification status
  notified: { type: Boolean, default: false },
  notifiedAt: { type: Date, default: null },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now }
});

// Create compound index for deduplication
emailSchema.index({ telegramChatId: 1, provider: 1, messageId: 1 }, { unique: true });

// ==================== SESSION SCHEMA ====================
// For tracking onboarding conversation state
const sessionSchema = new mongoose.Schema({
  telegramChatId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Conversation state
  state: {
    type: String,
    enum: [
      'START',
      'AWAITING_PROVIDER_CHOICE',
      'AWAITING_GMAIL_AUTH',
      'AWAITING_OUTLOOK_AUTH',
      'SETUP_COMPLETE',
      'IDLE'
    ],
    default: 'START'
  },
  
  // Temporary data during onboarding
  pendingProvider: { type: String, default: null },
  oauthState: { type: String, default: null }, // For CSRF protection
  
  // Track what's been set up
  gmailConnected: { type: Boolean, default: false },
  outlookConnected: { type: Boolean, default: false },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
  }
});

// Auto-expire sessions
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Update timestamp on save
sessionSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// ==================== MODELS ====================
const User = mongoose.model('User', userSchema);
const Email = mongoose.model('Email', emailSchema);
const Session = mongoose.model('Session', sessionSchema);

module.exports = {
  User,
  Email,
  Session
};
