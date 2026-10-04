import express from 'express';
import mongoose from 'mongoose';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/vlogs (Public)
router.get('/', async (req, res) => {
    try {
        const MotoVlog = mongoose.model('MotoVlog');
        const vlogs = await MotoVlog.find().sort({ createdAt: -1 });
        res.json(vlogs);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// POST /api/vlogs (Protected)
router.post('/', protect, async (req, res) => {
    try {
        const { title, locationName, coordinates, videoUrl, thumbnail, productsUsed } = req.body;

        if (!title || !videoUrl) {
            return res.status(400).json({ message: 'Başlık ve video bağlantısı zorunludur.' });
        }

        const MotoVlog = mongoose.model('MotoVlog');
        const authorName = req.user.name || req.user.username || 'MotoVibe Sürücüsü';

        const newVlog = new MotoVlog({
            title,
            author: authorName,
            authorId: req.user._id,
            locationName,
            coordinates,
            videoUrl,
            thumbnail,
            productsUsed: productsUsed || [],
            views: '0'
        });

        await newVlog.save();
        res.status(201).json(newVlog);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// PUT /api/vlogs/:id (Protected, Owner or Admin)
router.put('/:id', protect, async (req, res) => {
    try {
        const MotoVlog = mongoose.model('MotoVlog');
        const vlog = await MotoVlog.findById(req.params.id);

        if (!vlog) {
            return res.status(404).json({ message: 'Vlog bulunamadı.' });
        }

        const requesterId = req.user._id.toString();
        const isOwner = vlog.authorId && vlog.authorId.toString() === requesterId;
        if (!isOwner && !req.user.isAdmin) {
            return res.status(403).json({ message: 'Bu vlogu düzenleme yetkiniz yok.' });
        }

        const { title, locationName, coordinates, videoUrl, thumbnail, productsUsed } = req.body;
        if (title !== undefined) vlog.title = title;
        if (locationName !== undefined) vlog.locationName = locationName;
        if (coordinates !== undefined) vlog.coordinates = coordinates;
        if (videoUrl !== undefined) vlog.videoUrl = videoUrl;
        if (thumbnail !== undefined) vlog.thumbnail = thumbnail;
        if (productsUsed !== undefined) vlog.productsUsed = productsUsed;

        await vlog.save();
        res.json(vlog);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// DELETE /api/vlogs/:id (Protected, Owner or Admin)
router.delete('/:id', protect, async (req, res) => {
    try {
        const MotoVlog = mongoose.model('MotoVlog');
        const vlog = await MotoVlog.findById(req.params.id);

        if (!vlog) {
            return res.status(404).json({ message: 'Vlog bulunamadı.' });
        }

        const requesterId = req.user._id.toString();
        const isOwner = vlog.authorId && vlog.authorId.toString() === requesterId;
        if (!isOwner && !req.user.isAdmin) {
            return res.status(403).json({ message: 'Bu vlogu silme yetkiniz yok.' });
        }

        await MotoVlog.findByIdAndDelete(req.params.id);
        res.json({ message: 'Vlog silindi' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

export default router;
