/**
 * Enhanced Vercel Serverless Function - Daily Limit Controller (Anti-Bypass)
 * 
 * This API handles daily limit tracking with advanced anti-bypass protection.
 * Features:
 * - IP address detection and tracking
 * - Device fingerprinting support
 * - Multi-layer security (IP + User Agent + User ID + Device Fingerprint)
 * - SHA-256 hashing for secure identification
 * - Automatic cleanup of old entries
 * - CORS support for browser extensions
 * - Enhanced anti-bypass protection
 * 
 * @version 1.1
 * @author Your Name
 * @deployment Deploy to Vercel
 */

// In-memory storage (resets on cold start, but works for daily limits)
let dailyLimits = new Map();
let suspiciousActivity = new Map(); // Track suspicious behavior

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
    const { userId, action, deviceFingerprint } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

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
    
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Check for suspicious activity (multiple user IDs from same IP)
    await checkSuspiciousActivity(clientIP, userId);

    switch (action) {
      case 'check_and_increment':
        return await handleCheckAndIncrement(primaryKey, secondaryKey, tertiaryKey, res, clientIP, userId);
      
      case 'get_remaining':
        return await handleGetRemaining(primaryKey, secondaryKey, tertiaryKey, res, clientIP);
      
      case 'reset':
        return await handleReset(primaryKey, secondaryKey, tertiaryKey, res, clientIP);
      
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
  const ipKey = `suspicious:${clientIP}`;
  const userIds = suspiciousActivity.get(ipKey) || new Set();
  
  if (userIds.size > 0 && !userIds.has(userId)) {
    // Multiple user IDs from same IP - suspicious!
    console.warn(`Suspicious activity detected: IP ${clientIP} has ${userIds.size + 1} different user IDs`);
    
    // Apply stricter limits for suspicious IPs
    const strictKey = `strict_limit:${clientIP}:${new Date().toISOString().split('T')[0]}`;
    const currentStrictCount = dailyLimits.get(strictKey) || 0;
    
    if (currentStrictCount >= 5) { // Stricter limit for suspicious IPs
      throw new Error('Suspicious activity detected - stricter limits applied');
    }
    
    dailyLimits.set(strictKey, currentStrictCount + 1);
  }
  
  userIds.add(userId);
  suspiciousActivity.set(ipKey, userIds);
}

async function handleCheckAndIncrement(primaryKey, secondaryKey, tertiaryKey, res, clientIP, userId) {
  const today = new Date().toISOString().split('T')[0];
  
  // Check all three keys for the highest count
  const primaryCount = dailyLimits.get(`${primaryKey}:${today}`) || 0;
  const secondaryCount = dailyLimits.get(`${secondaryKey}:${today}`) || 0;
  const tertiaryCount = dailyLimits.get(`${tertiaryKey}:${today}`) || 0;
  
  const currentCount = Math.max(primaryCount, secondaryCount, tertiaryCount);
  
  if (currentCount >= 10) {
    return res.json({
      allowed: false,
      remaining: 0,
      used: currentCount,
      message: 'Daily limit reached',
      ip: clientIP,
      timestamp: new Date().toISOString(),
      security: 'Enhanced tracking active'
    });
  }

  // Increment all three keys for redundancy
  const newCount = currentCount + 1;
  dailyLimits.set(`${primaryKey}:${today}`, newCount);
  dailyLimits.set(`${secondaryKey}:${today}`, newCount);
  dailyLimits.set(`${tertiaryKey}:${today}`, newCount);

  // Clean up old entries (older than 2 days)
  cleanupOldEntries();

  return res.json({
    allowed: true,
    remaining: 10 - newCount,
    used: newCount,
    message: 'Comment generated successfully',
    ip: clientIP,
    timestamp: new Date().toISOString(),
    security: 'Enhanced tracking active'
  });
}

async function handleGetRemaining(primaryKey, secondaryKey, tertiaryKey, res, clientIP) {
  const today = new Date().toISOString().split('T')[0];
  
  const primaryCount = dailyLimits.get(`${primaryKey}:${today}`) || 0;
  const secondaryCount = dailyLimits.get(`${secondaryKey}:${today}`) || 0;
  const tertiaryCount = dailyLimits.get(`${tertiaryKey}:${today}`) || 0;
  
  const currentCount = Math.max(primaryCount, secondaryCount, tertiaryCount);
  const remaining = Math.max(0, 10 - currentCount);

  return res.json({
    remaining,
    used: currentCount,
    total: 10,
    ip: clientIP,
    timestamp: new Date().toISOString(),
    security: 'Enhanced tracking active'
  });
}

async function handleReset(primaryKey, secondaryKey, tertiaryKey, res, clientIP) {
  const today = new Date().toISOString().split('T')[0];
  
  dailyLimits.delete(`${primaryKey}:${today}`);
  dailyLimits.delete(`${secondaryKey}:${today}`);
  dailyLimits.delete(`${tertiaryKey}:${today}`);
  
  return res.json({
    success: true,
    message: 'Daily limit reset successfully',
    ip: clientIP,
    timestamp: new Date().toISOString(),
    security: 'Enhanced tracking active'
  });
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

// Enhanced hash function for security
async function hashString(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
}
