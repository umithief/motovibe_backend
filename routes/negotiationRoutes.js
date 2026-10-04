import express from 'express';
import mongoose from 'mongoose';

const router = express.Router();

// GET all negotiations
router.get('/', async (req, res) => {
    try {
        const Negotiation = mongoose.model('Negotiation');
        const offers = await Negotiation.find().sort({ date: -1 });
        res.json(offers);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// POST new offer
router.post('/', async (req, res) => {
    try {
        const Negotiation = mongoose.model('Negotiation');
        const newOffer = new Negotiation(req.body);
        await newOffer.save();
        res.status(201).json(newOffer);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// PUT update status
router.put('/:id', async (req, res) => {
    try {
        const Negotiation = mongoose.model('Negotiation');
        const updatedOffer = await Negotiation.findOne({ id: req.params.id }) || await Negotiation.findById(req.params.id);

        if (!updatedOffer) return res.status(404).json({ message: 'Offer not found' });

        updatedOffer.status = req.body.status;
        await updatedOffer.save();
        res.json(updatedOffer);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

export default router;
