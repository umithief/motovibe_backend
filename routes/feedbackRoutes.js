import express from 'express';
import mongoose from 'mongoose';

const router = express.Router();

// GET all feedback
router.get('/', async (req, res) => {
    try {
        // Find existing model or use schema if not compiled yet (Server.js usually handles this)
        // Check if Feedback model exists, if not it might be missing in server.js
        // Need to check server.js if "Feedback" schema is defined. 
        // Based on audit, Feedback schema was NOT in server.js! I need to add it there or here.
        // I will add it here to be safe, but ideally in server.js

        // Checking if model exists
        let Feedback;
        try {
            Feedback = mongoose.model('Feedback');
        } catch {
            const feedbackSchema = new mongoose.Schema({
                id: String,
                userId: String,
                userName: String,
                type: String,
                rating: Number,
                message: String,
                date: String,
                status: { type: String, default: 'new' }
            });
            Feedback = mongoose.model('Feedback', feedbackSchema);
        }

        const items = await Feedback.find().sort({ _id: -1 });
        res.json(items);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// POST new feedback
router.post('/', async (req, res) => {
    try {
        const Feedback = mongoose.model('Feedback');
        const newFeedback = new Feedback(req.body);
        await newFeedback.save();
        res.status(201).json(newFeedback);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

export default router;
