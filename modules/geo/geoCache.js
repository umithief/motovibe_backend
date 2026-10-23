import redis from '../../config/redis.js';

const memoryCache = new Map();
const metrics = { memoryHits: 0, redisHits: 0, misses: 0, writes: 0, redisErrors: 0 };

const now = () => Date.now();

export const getCached = async (key) => {
    const memory = process.env.NODE_ENV !== 'production' ? memoryCache.get(key) : null;
    if (memory && memory.expiresAt > now()) {
        metrics.memoryHits += 1;
        return memory.value;
    }
    if (memory) memoryCache.delete(key);

    try {
        const serialized = await redis.get(key);
        if (!serialized) {
            metrics.misses += 1;
            return null;
        }
        const value = JSON.parse(serialized);
        metrics.redisHits += 1;
        return value;
    } catch (_) {
        metrics.redisErrors += 1;
        metrics.misses += 1;
        return null;
    }
};

export const setCached = async (key, value, ttlSeconds) => {
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return value;
    metrics.writes += 1;
    if (process.env.NODE_ENV !== 'production') {
        memoryCache.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
    }
    try {
        await redis.set(key, JSON.stringify(value), 'EX', Math.floor(ttlSeconds));
    } catch (_) {
        // Redis is optional. The bounded memory cache preserves graceful degradation.
    }
    return value;
};

export const cacheKey = (...parts) => `geo:${parts.map((part) => String(part)).join(':')}`;

export const getGeoCacheMetrics = () => ({ ...metrics, memoryEntries: memoryCache.size });
