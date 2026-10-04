const fs = require('fs');
const filePath = 'routes/slideRoutes.js';
let content = fs.readFileSync(filePath, 'utf8');

// We know the file has missing try blocks. Let's just rewrite the whole routes to be sure.
content = `import express from 'express';
import mongoose from 'mongoose';
import { admin, protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/slides
router.get('/', async (req, res) => {
    try {
        const Slide = mongoose.model('Slide');
        const includeInactive = req.query.includeInactive === 'true';
        
        let slides;
        if (includeInactive) {
            slides = await Slide.find().lean().sort({ order: 1 });
        } else {
            slides = await Slide.getActiveSlides();
        }
        res.json(slides);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// PUT /api/slides/reorder
router.put('/reorder', protect, admin, async (req, res) => {
    try {
        const { slideIds } = req.body;
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
        const Slide = mongoose.model('Slide');
        const newSlide = new Slide(req.body);
        await newSlide.save();
        res.status(201).json(newSlide);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// PUT /api/slides/:id
router.put('/:id', protect, admin, async (req, res) => {
    try {
        const Slide = mongoose.model('Slide');
        const updatedSlide = await Slide.findByIdAndUpdate(req.params.id, req.body, { new: true });
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
`;

fs.writeFileSync(filePath, content);
console.log('Fixed slideRoutes.js');
