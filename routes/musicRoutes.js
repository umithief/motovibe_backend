import express from 'express';
import mongoose from 'mongoose';
import { admin, protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// GET all music
router.get('/', async (req, res) => {
    try {
        const Music = mongoose.model('Music');
        const tracks = await Music.find().sort({ addedAt: -1 });
        res.json(tracks);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// POST new track
router.post('/', protect, admin, async (req, res) => {
    try {
        const Music = mongoose.model('Music');
        const newTrack = new Music(req.body);
        if (!newTrack.id) newTrack.id = `TRK-${Date.now()}`;
        if (!newTrack.addedAt) newTrack.addedAt = new Date().toISOString();

        await newTrack.save();
        res.status(201).json(newTrack);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// DELETE track
router.delete('/:id', protect, admin, async (req, res) => {
    try {
        const Music = mongoose.model('Music');
        await Music.findOneAndDelete({ id: req.params.id }) || await Music.findByIdAndDelete(req.params.id);
        res.json({ message: 'Track deleted' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

export default router;
