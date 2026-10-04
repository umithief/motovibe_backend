import cron from 'node-cron';
import User from '../models/User.js';

export const expireBusinessFlashOffers = async (now = new Date()) => {
    const result = await User.updateMany(
        {
            'businessProfile.flashOffers': {
                $elemMatch: { isActive: true, validUntil: { $lte: now } }
            }
        },
        { $set: { 'businessProfile.flashOffers.$[offer].isActive': false } },
        { arrayFilters: [{ 'offer.isActive': true, 'offer.validUntil': { $lte: now } }] }
    );
    return result.modifiedCount || 0;
};

export const initBusinessFlashExpiryCron = () => {
    cron.schedule('*/5 * * * *', async () => {
        try {
            await expireBusinessFlashOffers();
        } catch (error) {
            console.error('[BusinessFlashExpiry] Job failed:', error.message);
        }
    });
};
