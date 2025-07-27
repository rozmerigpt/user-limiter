// Vercel serverless function for daily limits
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
    const { userId, action } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const key = `${userId}:${today}`;

    switch (action) {
      case 'check_and_increment':
        return await handleCheckAndIncrement(key, res);
      
      case 'get_remaining':
        return await handleGetRemaining(key, res);
      
      case 'reset':
        return await handleReset(key, res);
      
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

async function handleCheckAndIncrement(key, res) {
  const currentCount = dailyLimits.get(key) || 0;
  
  if (currentCount >= 10) {
    return res.json({
      allowed: false,
      remaining: 0,
      used: currentCount,
      message: 'Daily limit reached'
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
    message: 'Comment generated successfully'
  });
}

async function handleGetRemaining(key, res) {
  const currentCount = dailyLimits.get(key) || 0;
  const remaining = Math.max(0, 10 - currentCount);

  return res.json({
    remaining,
    used: currentCount,
    total: 10
  });
}

async function handleReset(key, res) {
  dailyLimits.delete(key);
  
  return res.json({
    success: true,
    message: 'Daily limit reset successfully'
  });
}

function cleanupOldEntries() {
  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const cutoffDate = twoDaysAgo.toISOString().split('T')[0];

  for (const [key] of dailyLimits) {
    const date = key.split(':')[1];
    if (date < cutoffDate) {
      dailyLimits.delete(key);
    }
  }
} 