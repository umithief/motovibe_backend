import express from 'express';
import mongoose from 'mongoose';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// GET all stolen items
router.get('/', async (req, res) => {
    try {
        const StolenItem = mongoose.model('StolenItem');
        const items = await StolenItem.find().sort({ dateReported: -1 });
        res.json(items);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// POST report stolen item
router.post('/', protect, async (req, res) => {
    try {
        const StolenItem = mongoose.model('StolenItem');
        const itemData = {
            ...req.body,
            reportedBy: req.user._id,
            reportedByName: req.user.name || req.user.username || 'Kullanıcı'
        };
        const newItem = new StolenItem(itemData);
        await newItem.save();
        res.status(201).json(newItem);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// PUT update status
router.put('/:id', protect, async (req, res) => {
    try {
        const StolenItem = mongoose.model('StolenItem');
        const item = await StolenItem.findById(req.params.id);
        if (!item) {
            return res.status(404).json({ message: 'İlan bulunamadı.' });
        }

        const isOwner = item.reportedBy && item.reportedBy.toString() === req.user._id.toString();
        if (!isOwner && !req.user.isAdmin) {
            return res.status(403).json({ message: 'Yalnızca ilanı veren sürücü durumu güncelleyebilir.' });
        }

        const updatedItem = await StolenItem.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json(updatedItem);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

export default router;
