import { serializeMediaUrls } from "../../../utils/serializeMediaUrls.js";
import express from 'express';
import mongoose from 'mongoose';

const router = express.Router();

// GET all negotiations
router.get('/', async (req, res) => {
    try {
        const Negotiation = mongoose.model('Negotiation');
        const offers = await Negotiation.find().sort({ date: -1 });
        res.json(serializeMediaUrls(offers, res.req));
    } catch (error) {
        res.status(500).json(serializeMediaUrls({ message: error.message }, res.req));
    }
});

// POST new offer
router.post('/', async (req, res) => {
    try {
        const Negotiation = mongoose.model('Negotiation');
        const newOffer = new Negotiation(req.body);
        await newOffer.save();
        res.status(201).json(serializeMediaUrls(newOffer, res.req));
    } catch (error) {
        res.status(400).json(serializeMediaUrls({ message: error.message }, res.req));
    }
});

// PUT update status
router.put('/:id', async (req, res) => {
    try {
        const Negotiation = mongoose.model('Negotiation');
        const updatedOffer = await Negotiation.findOne({ id: req.params.id }) || await Negotiation.findById(req.params.id);

        if (!updatedOffer) return res.status(404).json(serializeMediaUrls({ message: 'Offer not found' }, res.req));

        updatedOffer.status = req.body.status;
        await updatedOffer.save();
        res.json(serializeMediaUrls(updatedOffer, res.req));
    } catch (error) {
        res.status(400).json(serializeMediaUrls({ message: error.message }, res.req));
    }
});

export default router;
