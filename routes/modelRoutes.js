import express from 'express';
import mongoose from 'mongoose';
import { admin, protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// GET all models
router.get('/', async (req, res) => {
    try {
        const Model3D = mongoose.model('Model3D');
        const models = await Model3D.find().sort({ _id: -1 });
        res.json(models);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// POST new model
router.post('/', protect, admin, async (req, res) => {
    try {
        const Model3D = mongoose.model('Model3D');
        const newModel = new Model3D(req.body);
        await newModel.save();
        res.status(201).json(newModel);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// DELETE model
router.delete('/:id', protect, admin, async (req, res) => {
    try {
        const Model3D = mongoose.model('Model3D');
        await Model3D.findByIdAndDelete(req.params.id);
        res.json({ message: 'Model deleted' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

export default router;
