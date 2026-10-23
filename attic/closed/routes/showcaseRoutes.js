import { serializeMediaUrls } from "../../../utils/serializeMediaUrls.js";
import express from 'express';
import mongoose from 'mongoose';
import { admin, protect } from "../../../middleware/authMiddleware.js";

const router = express.Router();

// GET all showcase items
router.get('/', async (req, res) => {
    try {
        const ShowcaseProduct = mongoose.model('ShowcaseProduct');
        const items = await ShowcaseProduct.find({}).lean();
        res.json(serializeMediaUrls(items, res.req));
    } catch (error) {
        res.status(500).json(serializeMediaUrls({ message: error.message }, res.req));
    }
});

// POST new showcase item
router.post('/', protect, admin, async (req, res) => {
    try {
        const ShowcaseProduct = mongoose.model('ShowcaseProduct');
        const newItem = new ShowcaseProduct(req.body);
        await newItem.save();
        res.status(201).json(serializeMediaUrls(newItem, res.req));
    } catch (error) {
        res.status(400).json(serializeMediaUrls({ message: error.message }, res.req));
    }
});

// PUT update showcase item
router.put('/:id', protect, admin, async (req, res) => {
    try {
        const ShowcaseProduct = mongoose.model('ShowcaseProduct');
        const updatedItem = await ShowcaseProduct.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json(serializeMediaUrls(updatedItem, res.req));
    } catch (error) {
        res.status(400).json(serializeMediaUrls({ message: error.message }, res.req));
    }
});

// DELETE showcase item
router.delete('/:id', protect, admin, async (req, res) => {
    try {
        const ShowcaseProduct = mongoose.model('ShowcaseProduct');
        await ShowcaseProduct.findByIdAndDelete(req.params.id);
        res.json(serializeMediaUrls({ message: 'Item deleted' }, res.req));
    } catch (error) {
        res.status(500).json(serializeMediaUrls({ message: error.message }, res.req));
    }
});

export default router;
