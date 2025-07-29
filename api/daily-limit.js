/**
 * Enhanced Vercel Serverless Function - Daily Limit Controller (Anti-Bypass)
 * 
 * This API handles daily limit tracking with advanced anti-bypass protection.
 * Features:
 * - File-based persistent storage for reliability
 * - IP address detection and tracking
 * - Device fingerprinting support
 * - Multi-layer security (IP + User Agent + User ID + Device Fingerprint)
 * - SHA-256 hashing for secure identification
 * - Automatic cleanup of old entries
 * - CORS support for browser extensions
 * - Enhanced anti-bypass protection
 * - 10 comments/day, 2 posts/day limits
 * 
 * @version 1.3
 * @author Your Name
 * @deployment Deploy to Vercel
 */

import fs from 'fs';
import path from 'path';

// File-based persistent storage
class FileBasedStorage {
  constructor() {
    this.storageFile = '/tmp/daily_limits.json';
    this.suspiciousFile = '/tmp/suspicious_activity.json';
    this.ensureFilesExist();
  }

  ensureFilesExist() {
    try {
      if (!fs.existsSync(this.storageFile)) {
        fs.writeFileSync(this.storageFile, JSON.stringify({}));
      }
      if (!fs.existsSync(this.suspiciousFile)) {
        fs.writeFileSync(this.suspiciousFile, JSON.stringify({}));
      }
    } catch (error) {
      console.log('Using fallback storage');
    }
  }

  async get(key) {
    try {
      const data = JSON.parse(fs.readFileSync(this.storageFile, 'utf8'));
      const item = data[key];
      if (!item) return 0;
      
      // Check if expired (24 hours)
      if (item.expires && Date.now() > item.expires) {
        delete data[key];
        fs.writeFileSync(this.storageFile, JSON.stringify(data));
        return 0;
      }
      
      return item.value || 0;
    } catch (error) {
      console.log('Storage read error, using fallback');
      return 0;
    }
  }

  async set(key, value, ttl = 86400) {
    try {
      const data = JSON.parse(fs.readFileSync(this.storageFile, 'utf8'));
      data[key] = {
        value: value,
        expires: Date.now() + (ttl * 1000),
        timestamp: new Date().toISOString()
      };
      fs.writeFileSync(this.storageFile, JSON.stringify(data));
    } catch (error) {
      console.log('Storage write error');
    }
  }

  async getSuspicious(ip) {
    try {
      const data = JSON.parse(fs.readFileSync(this.suspiciousFile, 'utf8'));
      return data[ip] || { userIds: [], count: 0 };
    } catch (error) {
      return { userIds: [], count: 0 };
    }
  }

  async setSuspicious(ip, data) {
    try {
      const fileData = JSON.parse(fs.readFileSync(this.suspiciousFile, 'utf8'));
      fileData[ip] = data;
      fs.writeFileSync(this.suspiciousFile, JSON.stringify(fileData));
    } catch (error) {
      console.log('Suspicious storage write error');
    }
  }

  cleanup() {
    try {
      const data = JSON.parse(fs.readFileSync(this.storageFile, 'utf8'));
      const now = Date.now();
      let cleaned = false;
      
      for (const [key, item] of Object.entries(data)) {
        if (item.expires && now > item.expires) {
          delete data[key];
          cleaned = true;
        }
      }
      
      if (cleaned) {
        fs.writeFileSync(this.storageFile, JSON.stringify(data));
      }
    } catch (error) {
      console.log('Cleanup error');
    }
  }
}

const storage = new FileBasedStorage();

export default async function handler(req, res) {
  // Enable CORS for extension
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, action, deviceFingerprint, type = 'comments' } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    // Cleanup expired entries
    storage.cleanup();

    // Get client IP address
    const clientIP = req.headers['x-forwarded-for'] || 
                    req.headers['x-real-ip'] || 
                    req.connection.remoteAddress || 
                    req.socket.remoteAddress;

    // Create enhanced unique identifier with more factors
    const userAgent = req.headers['user-agent'] || '';
    const acceptLanguage = req.headers['accept-language'] || '';
    const acceptEncoding = req.headers['accept-encoding'] || '';
    const referer = req.headers['referer'] || '';
    
    // Enhanced fingerprint with more browser characteristics
    const enhancedFingerprint = {
      ip: clientIP,
      userAgent: userAgent.substring(0, 100),
      language: acceptLanguage,
      encoding: acceptEncoding,
      referer: referer,
      deviceFingerprint: deviceFingerprint,
      timestamp: new Date().toISOString().split('T')[0]
    };
    
    // Create multiple tracking keys for redundancy
    const primaryKey = await hashString(`${clientIP}-${userAgent.substring(0, 50)}-${deviceFingerprint}`);
    const secondaryKey = await hashString(`${clientIP}-${deviceFingerprint}`);
    const tertiaryKey = await hashString(`${userAgent.substring(0, 30)}-${deviceFingerprint}`);
    
    // Get current UTC date for consistent timezone handling
    const now = new Date();
    const utcDate = now.toISOString().split('T')[0]; // YYYY-MM-DD in UTC
    const utcHour = now.getUTCHours();
    const utcMinute = now.getUTCMinutes();
    
    // Check if it's past midnight UTC (00:00)
    const isNewDay = utcHour === 0 && utcMinute < 5; // Allow 5-minute window for reset
    
    // Check for suspicious activity (multiple user IDs from same IP)
    const isSuspicious = await checkSuspiciousActivity(clientIP, userId);

    switch (action) {
      case 'check_and_increment':
        return await handleCheckAndIncrement(primaryKey, secondaryKey, tertiaryKey, res, clientIP, userId, type, isSuspicious);
      
      case 'get_remaining':
        return await handleGetRemaining(primaryKey, secondaryKey, tertiaryKey, res, clientIP, type, isSuspicious);
      
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }

  } catch (error) {
    console.error('Limit controller error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      allowed: true, 
      remaining: 9 
    });
  }
}

async function checkSuspiciousActivity(clientIP, userId) {
  const suspiciousKey = `suspicious:${clientIP}`;
  
  // Get existing suspicious activity for this IP
  const existingActivity = await storage.getSuspicious(clientIP);
  
  // Convert Set to Array for storage compatibility
  if (typeof existingActivity.userIds === 'object' && !Array.isArray(existingActivity.userIds)) {
    existingActivity.userIds = Array.from(existingActivity.userIds);
  }
  
  const userIds = new Set(existingActivity.userIds || []);
  userIds.add(userId);
  
  // Update suspicious activity
  await storage.setSuspicious(clientIP, {
    userIds: Array.from(userIds),
    count: userIds.size,
    lastSeen: new Date().toISOString()
  });
  
  // If more than 3 different user IDs from same IP, apply stricter limits
  if (userIds.size > 3) {
    console.log(`Suspicious activity detected: ${userIds.size} different user IDs from IP ${clientIP}`);
    return true;
  }
  
  return false;
}

async function handleCheckAndIncrement(primaryKey, secondaryKey, tertiaryKey, res, clientIP, userId, type = 'comments', isSuspicious) {
  const now = new Date();
  const utcDate = now.toISOString().split('T')[0];
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();

  // Apply stricter limits for suspicious activity
  let dailyLimit = type === 'posts' ? 2 : 10;
  if (isSuspicious) {
    dailyLimit = type === 'posts' ? 1 : 5; // Stricter limits for suspicious IPs
  }
  
  const typeSuffix = `:${type}`;

  // Check if it's a new day (past midnight UTC)
  const isNewDay = utcHour === 0 && utcMinute < 5;

  // Get current counts from persistent storage
  const primaryCount = await storage.get(`${primaryKey}:${utcDate}${typeSuffix}`);
  const secondaryCount = await storage.get(`${secondaryKey}:${utcDate}${typeSuffix}`);
  const tertiaryCount = await storage.get(`${tertiaryKey}:${utcDate}${typeSuffix}`);

  // Use the highest count for security
  const currentCount = Math.max(primaryCount, secondaryCount, tertiaryCount);

  // Check if limit is reached
  if (currentCount >= dailyLimit) {
    const resetTime = getNextResetTime();
    return res.status(200).json({
      allowed: false,
      remaining: 0,
      resetTime: resetTime,
      message: `Daily limit of ${dailyLimit} ${type} reached. Resets at ${resetTime}`,
      suspicious: isSuspicious
    });
  }

  // Increment counts in persistent storage
  await storage.set(`${primaryKey}:${utcDate}${typeSuffix}`, currentCount + 1, 86400);
  await storage.set(`${secondaryKey}:${utcDate}${typeSuffix}`, currentCount + 1, 86400);
  await storage.set(`${tertiaryKey}:${utcDate}${typeSuffix}`, currentCount + 1, 86400);

  const remaining = dailyLimit - (currentCount + 1);
  const resetTime = getNextResetTime();

  return res.status(200).json({
    allowed: true,
    remaining: remaining,
    resetTime: resetTime,
    message: `${type.charAt(0).toUpperCase() + type.slice(1)} generated successfully. ${remaining} remaining today.`,
    suspicious: isSuspicious
  });
}

async function handleGetRemaining(primaryKey, secondaryKey, tertiaryKey, res, clientIP, type = 'comments', isSuspicious) {
  const now = new Date();
  const utcDate = now.toISOString().split('T')[0];
  
  // Apply stricter limits for suspicious activity
  let dailyLimit = type === 'posts' ? 2 : 10;
  if (isSuspicious) {
    dailyLimit = type === 'posts' ? 1 : 5; // Stricter limits for suspicious IPs
  }
  
  const typeSuffix = `:${type}`;
  
  // Get current counts from persistent storage
  const primaryCount = await storage.get(`${primaryKey}:${utcDate}${typeSuffix}`);
  const secondaryCount = await storage.get(`${secondaryKey}:${utcDate}${typeSuffix}`);
  const tertiaryCount = await storage.get(`${tertiaryKey}:${utcDate}${typeSuffix}`);

  // Use the highest count for security
  const currentCount = Math.max(primaryCount, secondaryCount, tertiaryCount);
  const remaining = Math.max(0, dailyLimit - currentCount);
  const resetTime = getNextResetTime();

  return res.status(200).json({
    remaining: remaining,
    resetTime: resetTime,
    message: `${remaining} ${type} remaining today. Resets at ${resetTime}`,
    suspicious: isSuspicious
  });
}

// Removed manual reset function - now using automatic UTC-based resets

function getNextResetTime() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  
  return tomorrow.toISOString();
}

function cleanupOldEntries() {
  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const cutoffDate = twoDaysAgo.toISOString().split('T')[0];

  for (const [key] of dailyLimits) {
    const date = key.split(':')[2];
    if (date < cutoffDate) {
      dailyLimits.delete(key);
    }
  }
  
  // Clean up suspicious activity older than 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  for (const [key] of suspiciousActivity) {
    const date = key.split(':')[1];
    if (date < sevenDaysAgo.toISOString().split('T')[0]) {
      suspiciousActivity.delete(key);
    }
  }
}

// Simple hash function for security
async function hashString(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
} 
