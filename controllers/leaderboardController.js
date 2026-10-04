import { fetchLeaderboard, resetWeeklyLeaderboards } from '../services/leaderboardService.js';

export const getLeaderboard = async (req, res) => {
    try {
        const filter = (req.query.filter || 'global').toLowerCase();
        const city = req.query.city;
        const payload = await fetchLeaderboard({
            category: req.params.category,
            filter,
            userId: req.user?.id,
            city
        });
        return res.json(payload);
    } catch (err) {
        console.error('[Leaderboard] fetch error:', err);
        return res.status(400).json({
            status: 'error',
            message: err.message || 'Leaderboard fetch failed'
        });
    }
};

export const resetLeaderboard = async (req, res) => {
    try {
        await resetWeeklyLeaderboards();
        return res.json({
            status: 'success',
            message: 'ApexBoard verileri başarıyla sıfırlandı.'
        });
    } catch (err) {
        console.error('[Leaderboard] reset error:', err);
        return res.status(500).json({
            status: 'error',
            message: err.message || 'Sıfırlama başarısız oldu'
        });
    }
};

