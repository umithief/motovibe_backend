import express from 'express';
import mongoose from 'mongoose';
import Slide from '../models/Slide.js';
import { validateSlideBody } from '../utils/slideValidation.js';
import { admin, protect, checkUser } from '../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/slides
router.get('/', checkUser, async (req, res) => {
    try {
        const includeInactive = req.query.includeInactive === 'true';
        
        let slides;
        if (includeInactive) {
            if (!req.user || !req.user.isAdmin) {
                return res.status(403).json({ message: 'Tüm slaytları görüntülemek için yönetici yetkisi gereklidir.' });
            }
            slides = await Slide.find().lean().sort({ order: 1 });
        } else {
            if (typeof Slide.getActiveSlides === 'function') {
                slides = await Slide.getActiveSlides();
            } else {
                slides = await Slide.find({ isActive: true }).lean().sort({ order: 1 });
            }
        }
        res.json(slides);
    } catch (error) {
        console.error('[Get Slides Error]:', error);
        res.status(500).json({ message: error.message });
    }
});

// PUT /api/slides/reorder
router.put('/reorder', protect, admin, async (req, res) => {
    try {
        const { slideIds } = req.body;
        if (!Array.isArray(slideIds) || !slideIds.length || slideIds.length > 100 ||
            new Set(slideIds).size !== slideIds.length ||
            slideIds.some(id => typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id))) {
            return res.status(400).json({ message: 'Geçersiz slayt sıralaması.' });
        }
        const Slide = mongoose.model('Slide');
        
        // Update order for each slide
        for (let i = 0; i < slideIds.length; i++) {
            await Slide.findByIdAndUpdate(slideIds[i], { order: i });
        }
        res.json({ message: 'Sıralama güncellendi' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// POST /api/slides
router.post('/', protect, admin, async (req, res) => {
    try {
        const body = validateSlideBody(req.body);
        const newSlide = new Slide(body);
        await newSlide.save();
        res.status(201).json(newSlide);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// PUT /api/slides/:id
router.put('/:id', protect, admin, async (req, res) => {
    try {
        const existing = await Slide.findById(req.params.id).lean();
        if (!existing) return res.status(404).json({ message: 'Slayt bulunamadı.' });
        const patch = validateSlideBody(req.body, { partial: true });
        validateSlideBody({ ...existing, ...patch,
            startDate: patch.startDate !== undefined ? patch.startDate : existing.startDate?.toISOString() || null,
            endDate: patch.endDate !== undefined ? patch.endDate : existing.endDate?.toISOString() || null });
        const updatedSlide = await Slide.findByIdAndUpdate(req.params.id, patch, { new: true, runValidators: true });
        res.json(updatedSlide);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// DELETE /api/slides/:id
router.delete('/:id', protect, admin, async (req, res) => {
    try {
        const Slide = mongoose.model('Slide');
        await Slide.findByIdAndDelete(req.params.id);
        res.json({ message: 'Slide silindi' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

export default router;
