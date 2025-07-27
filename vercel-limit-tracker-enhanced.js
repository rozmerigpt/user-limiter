// Enhanced Vercel-based Daily Limit Tracker with IP and Device Tracking
class VercelLimitTracker {
  constructor() {
    this.apiUrl = 'https://user-limiter.vercel.app/api/daily-limit';
  }
  
  // Generate device fingerprint for better tracking
  generateDeviceFingerprint() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillText('Device fingerprint', 2, 2);
    
    const fingerprint = {
      canvas: canvas.toDataURL(),
      userAgent: navigator.userAgent,
      language: navigator.language,
      platform: navigator.platform,
      screenWidth: screen.width,
      screenHeight: screen.height,
      colorDepth: screen.colorDepth,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory,
      maxTouchPoints: navigator.maxTouchPoints
    };
    
    return btoa(JSON.stringify(fingerprint));
  }
  
  async checkAndIncrement(userId) {
    try {
      const deviceFingerprint = this.generateDeviceFingerprint();
      
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId,
          action: 'check_and_increment',
          deviceFingerprint
        })
      });
      
      if (!response.ok) {
        console.error('Vercel API error:', response.status);
        return { allowed: true, remaining: 9, error: 'Failed to check limit' };
      }
      
      const result = await response.json();
      console.log('Limit check result:', result);
      return result;
      
    } catch (error) {
      console.error('Vercel limit tracker error:', error);
      // Fallback - allow generation but log error
      return { allowed: true, remaining: 9, error: error.message };
    }
  }
  
  async getRemainingCount(userId) {
    try {
      const deviceFingerprint = this.generateDeviceFingerprint();
      
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId,
          action: 'get_remaining',
          deviceFingerprint
        })
      });
      
      if (!response.ok) {
        console.error('Failed to get remaining count:', response.status);
        return 10; // Fallback
      }
      
      const result = await response.json();
      return result.remaining || 10;
      
    } catch (error) {
      console.error('Error getting remaining count:', error);
      return 10; // Fallback
    }
  }
  
  async resetDailyLimit(userId) {
    try {
      const deviceFingerprint = this.generateDeviceFingerprint();
      
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId,
          action: 'reset',
          deviceFingerprint
        })
      });
      
      if (!response.ok) {
        console.error('Failed to reset limit:', response.status);
        return false;
      }
      
      const result = await response.json();
      return result.success || false;
      
    } catch (error) {
      console.error('Error resetting limit:', error);
      return false;
    }
  }
  
  // Get IP address from response (for debugging)
  async getClientIP(userId) {
    try {
      const deviceFingerprint = this.generateDeviceFingerprint();
      
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId,
          action: 'get_remaining',
          deviceFingerprint
        })
      });
      
      if (!response.ok) {
        return null;
      }
      
      const result = await response.json();
      return result.ip || null;
      
    } catch (error) {
      console.error('Error getting client IP:', error);
      return null;
    }
  }
}

// Enhanced User ID Generator with device tracking
class UserIdGenerator {
  static generateUserId() {
    // Generate a more robust user ID based on multiple factors
    const fingerprint = navigator.userAgent + 
                      navigator.language + 
                      screen.width + 
                      screen.height + 
                      navigator.platform +
                      Intl.DateTimeFormat().resolvedOptions().timeZone;
    
    let hash = 0;
    for (let i = 0; i < fingerprint.length; i++) {
      const char = fingerprint.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }
  
  static async getOrCreateUserId() {
    const result = await chrome.storage.sync.get(['user_id']);
    if (result.user_id) {
      return result.user_id;
    }
    
    const userId = this.generateUserId();
    await chrome.storage.sync.set({ user_id: userId });
    return userId;
  }
  
  // Get device info for debugging
  static getDeviceInfo() {
    return {
      userAgent: navigator.userAgent,
      language: navigator.language,
      platform: navigator.platform,
      screenResolution: `${screen.width}x${screen.height}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory
    };
  }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VercelLimitTracker, UserIdGenerator };
} 