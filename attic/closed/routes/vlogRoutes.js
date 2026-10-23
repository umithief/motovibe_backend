import { serializeMediaUrls } from "../../../utils/serializeMediaUrls.js";
import express from 'express';
import mongoose from 'mongoose';
import { protect } from "../../../middleware/authMiddleware.js";

const router = express.Router();

// GET /api/vlogs (Public)
router.get('/', async (req, res) => {
    try {
        const MotoVlog = mongoose.model('MotoVlog');
        const vlogs = await MotoVlog.find().sort({ createdAt: -1 });
        res.json(serializeMediaUrls(vlogs, res.req));
    } catch (error) {
        res.status(500).json(serializeMediaUrls({ message: error.message }, res.req));
    }
});

// POST /api/vlogs (Protected)
router.post('/', protect, async (req, res) => {
    try {
        const { title, locationName, coordinates, videoUrl, thumbnail, productsUsed } = req.body;

        if (!title || !videoUrl) {
            return res.status(400).json(serializeMediaUrls({ message: 'Başlık ve video bağlantısı zorunludur.' }, res.req));
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
        res.status(201).json(serializeMediaUrls(newVlog, res.req));
    } catch (error) {
        res.status(400).json(serializeMediaUrls({ message: error.message }, res.req));
    }
});

// PUT /api/vlogs/:id (Protected, Owner or Admin)
router.put('/:id', protect, async (req, res) => {
    try {
        const MotoVlog = mongoose.model('MotoVlog');
        const vlog = await MotoVlog.findById(req.params.id);

        if (!vlog) {
            return res.status(404).json(serializeMediaUrls({ message: 'Vlog bulunamadı.' }, res.req));
        }

        const requesterId = req.user._id.toString();
        const isOwner = vlog.authorId && vlog.authorId.toString() === requesterId;
        if (!isOwner && !req.user.isAdmin) {
            return res.status(403).json(serializeMediaUrls({ message: 'Bu vlogu düzenleme yetkiniz yok.' }, res.req));
        }

        const { title, locationName, coordinates, videoUrl, thumbnail, productsUsed } = req.body;
        if (title !== undefined) vlog.title = title;
        if (locationName !== undefined) vlog.locationName = locationName;
        if (coordinates !== undefined) vlog.coordinates = coordinates;
        if (videoUrl !== undefined) vlog.videoUrl = videoUrl;
        if (thumbnail !== undefined) vlog.thumbnail = thumbnail;
        if (productsUsed !== undefined) vlog.productsUsed = productsUsed;

        await vlog.save();
        res.json(serializeMediaUrls(vlog, res.req));
    } catch (error) {
        res.status(400).json(serializeMediaUrls({ message: error.message }, res.req));
    }
});

// DELETE /api/vlogs/:id (Protected, Owner or Admin)
router.delete('/:id', protect, async (req, res) => {
    try {
        const MotoVlog = mongoose.model('MotoVlog');
        const vlog = await MotoVlog.findById(req.params.id);

        if (!vlog) {
            return res.status(404).json(serializeMediaUrls({ message: 'Vlog bulunamadı.' }, res.req));
        }

        const requesterId = req.user._id.toString();
        const isOwner = vlog.authorId && vlog.authorId.toString() === requesterId;
        if (!isOwner && !req.user.isAdmin) {
            return res.status(403).json(serializeMediaUrls({ message: 'Bu vlogu silme yetkiniz yok.' }, res.req));
        }

        await MotoVlog.findByIdAndDelete(req.params.id);
        res.json(serializeMediaUrls({ message: 'Vlog silindi' }, res.req));
    } catch (error) {
        res.status(500).json(serializeMediaUrls({ message: error.message }, res.req));
    }
});

export default router;
