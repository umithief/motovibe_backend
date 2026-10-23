
import Redis from 'ioredis';


const redisUrl = process.env.REDIS_URI || process.env.REDIS_URL || 'redis://localhost:6379';

const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1, // Reduced to fail fast
    enableOfflineQueue: false, // DON'T queue commands if redis is down
    connectTimeout: 200, // 200ms timeout for connection (fail FAST)
    retryStrategy(times) {
        // Fast failure in dev, longer in prod
        if (times > 1) return null; // Don't even retry if not available immediately to save seconds
        const delay = Math.min(times * 100, 1000);
        return delay;
    }
});

let isConnected = false;

redis.on('ready', () => {
    isConnected = true;
    console.log('✅ Redis bağlantısı başarılı');
});

redis.on('close', () => { isConnected = false; });
redis.on('reconnecting', () => { isConnected = false; });

redis.on('error', (err) => {
    isConnected = false;
    // Suppress heavy connection error logs in dev without redis
    if (process.env.NODE_ENV === 'development' || !process.env.REDIS_URI) {
        if (err.code === 'ECONNREFUSED' || err.message.includes('Reached the max retries')) {
            // Silently fail in dev
            return;
        }
    }
});

// Create a wrapper that instantly fails if not connected to avoid timeout delays
const safeRedis = {
    get: async (key) => isConnected ? redis.get(key) : null,
    set: async (key, val, mode, time) => isConnected ? redis.set(key, val, mode, time) : null,
    lrange: async (key, start, end) => isConnected ? redis.lrange(key, start, end) : [],
    del: async (...keys) => isConnected ? redis.del(...keys) : null,
    rpush: async (key, ...vals) => isConnected ? redis.rpush(key, ...vals) : null,
    expire: async (key, ttl) => isConnected ? redis.expire(key, ttl) : null,
    keys: async (pattern) => isConnected ? redis.keys(pattern) : [],
    raw: redis
};

export default safeRedis;
