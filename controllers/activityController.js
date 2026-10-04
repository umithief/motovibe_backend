import RideActivity from '../models/RideActivity.js';

export const getLatestActivity = async (req, res) => {
    try {
        // Fix: Use req.user.id (from checkAuth middleware) and query 'user' field
        const latestRide = await RideActivity.findOne({ user: req.user.id })
            .sort({ startTime: -1 })
            .populate('route'); // Get linked route details if available

        if (!latestRide) {
            return res.status(404).json({ message: 'Son sürüş kaydı bulunamadı.' });
        }

        res.json(latestRide);
    } catch (error) {
        console.error("Activity Error:", error);
        res.status(500).json({ message: 'Error fetching latest activity', error: error.message });
    }
};

export const createActivity = async (req, res) => {
    try {
        const newRide = new RideActivity({
            ...req.body,
            userId: req.user.userId
        });
        await newRide.save();
        res.status(201).json(newRide);
    } catch (error) {
        res.status(500).json({ message: 'Error creating activity', error: error.message });
    }
};
