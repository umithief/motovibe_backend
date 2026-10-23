import { serviceResult } from '../../utils/serviceResult.js';
import { getConfig } from './feed.service.js';
import VibeConfig from './model.js';
import redis from '../../config/redis.js';
// --- ADMIN CONTROLLERS ---

export const getVibeSettings = async (input) => {
    try {
        const config = await getConfig();
        return serviceResult({ status: 'success', data: config },200);
    } catch (error) { throw error; }
};

export const updateVibeSettings = async (input) => {
    try {
        const updates = input.body;
        const existing = await VibeConfig.findById('default_config').lean();

        let finalUpdates = { ...updates };

        if (existing) {
            if (updates.timeDecay) {
                finalUpdates.timeDecay = {
                    ...existing.timeDecay,
                    ...updates.timeDecay
                };
                if (finalUpdates.timeDecay.maxAgeDays === undefined) {
                    finalUpdates.timeDecay.maxAgeDays = 30;
                }
            }
            if (updates.weights) {
                finalUpdates.weights = { ...existing.weights, ...updates.weights };
            }
            if (updates.multipliers) {
                finalUpdates.multipliers = { ...existing.multipliers, ...updates.multipliers };
            }
            if (updates.sponsored) {
                finalUpdates.sponsored = { ...existing.sponsored, ...updates.sponsored };
            }
            if (updates.telemetryConfig) {
                finalUpdates.telemetryConfig = { ...(existing.telemetryConfig || {}), ...updates.telemetryConfig };
            }
        }

        const config = await VibeConfig.findByIdAndUpdate(
            'default_config',
            { ...finalUpdates, lastUpdated: Date.now() },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        // Invalidate Config Cache
        try {
            await redis.del('vibe:config');

            // Invalidate ALL user feed caches so they get new algorithm immediately
            const keys = await redis.keys('feed:discover:*');
            if (keys.length > 0) {
                await redis.del(...keys);
            }
        } catch (redisErr) {
            console.warn('⚠️ VibeEngine Cache Invalidation Failed:', redisErr.message);
        }

        return serviceResult({ status: 'success', data: config, message: 'Settings updated & Caches cleared' },200);
    } catch (error) { throw error; }
};
