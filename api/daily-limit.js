// Enhanced Vercel serverless function with IP tracking
// Deploy this to your Vercel account

// In-memory storage (resets on cold start, but works for daily limits)
let dailyLimits = new Map();

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

    // Create enhanced unique identifier
    const userAgent = req.headers['user-agent'] || '';
    const acceptLanguage = req.headers['accept-language'] || '';
    
    // Combine IP + User Agent + User ID + Device Fingerprint for maximum security
    const uniqueIdentifier = `${clientIP}-${userAgent.substring(0, 50)}-${userId}-${deviceFingerprint || 'default'}`;
    
    // Hash the identifier for security
    const hashedId = await hashString(uniqueIdentifier);
    
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const key = `daily_limit:${hashedId}:${today}`;

    switch (action) {
      case 'check_and_increment':
        return await handleCheckAndIncrement(key, res, clientIP);
      
      case 'get_remaining':
        return await handleGetRemaining(key, res, clientIP);
      
      case 'reset':
        return await handleReset(key, res, clientIP);
      
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

async function handleCheckAndIncrement(key, res, clientIP) {
  const currentCount = dailyLimits.get(key) || 0;
  
  if (currentCount >= 10) {
    return res.json({
      allowed: false,
      remaining: 0,
      used: currentCount,
      message: 'Daily limit reached',
      ip: clientIP,
      timestamp: new Date().toISOString()
    });
  }

  // Increment count
  const newCount = currentCount + 1;
  dailyLimits.set(key, newCount);

  // Clean up old entries (older than 2 days)
  cleanupOldEntries();

  return res.json({
    allowed: true,
    remaining: 10 - newCount,
    used: newCount,
    message: 'Comment generated successfully',
    ip: clientIP,
    timestamp: new Date().toISOString()
  });
}

async function handleGetRemaining(key, res, clientIP) {
  const currentCount = dailyLimits.get(key) || 0;
  const remaining = Math.max(0, 10 - currentCount);

  return res.json({
    remaining,
    used: currentCount,
    total: 10,
    ip: clientIP,
    timestamp: new Date().toISOString()
  });
}

async function handleReset(key, res, clientIP) {
  dailyLimits.delete(key);
  
  return res.json({
    success: true,
    message: 'Daily limit reset successfully',
    ip: clientIP,
    timestamp: new Date().toISOString()
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
}

// Simple hash function for security
async function hashString(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
} 