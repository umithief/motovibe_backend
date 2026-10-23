import { sendResponse } from '../../utils/respond.js';
import catchAsync from '../../utils/catchAsync.js';
import { raiseHttpError } from '../../utils/httpError.js';
import { serializeMediaUrls } from "../../utils/serializeMediaUrls.js";
import { fetchLeaderboard, resetWeeklyLeaderboards } from "./service.js";

export const getLeaderboard = catchAsync(async (req, res) => {
    try {
        const filter = (req.query.filter || 'global').toLowerCase();
        const city = req.query.city;
        const payload = await fetchLeaderboard({
            category: req.params.category,
            filter,
            userId: req.user?.id,
            city
        });
        return sendResponse(res.req,res,payload,{statusCode:200});
    } catch (err) {
        console.error('[Leaderboard] fetch error:', err);
        return raiseHttpError({
            status: 'error',
            message: err.message || 'Leaderboard fetch failed'
        },400);
    }
});

export const resetLeaderboard = catchAsync(async (req, res) => {
    try {
        await resetWeeklyLeaderboards();
        return sendResponse(res.req,res,{
            status: 'success',
            message: 'ApexBoard verileri başarıyla sıfırlandı.'
        },{statusCode:200});
    } catch (err) { throw err; }
});
