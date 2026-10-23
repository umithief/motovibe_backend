import { serializeMediaUrls } from "../../../utils/serializeMediaUrls.js";
import express from 'express';
import mongoose from 'mongoose';

const router = express.Router();

// GET all topics
router.get('/', async (req, res) => {
    try {
        const ForumTopic = mongoose.model('ForumTopic');
        const topics = await ForumTopic.find().sort({ date: -1 }); // Newest first
        res.json(serializeMediaUrls(topics, res.req));
    } catch (error) {
        res.status(500).json(serializeMediaUrls({ message: error.message }, res.req));
    }
});

// GET query topics (search/filter)
router.get('/search', async (req, res) => {
    try {
        const ForumTopic = mongoose.model('ForumTopic');
        const { q, category } = req.query;
        let query = {};

        if (category && category !== 'Tümü') query.category = category;
        if (q) query.title = { $regex: q, $options: 'i' };

        const topics = await ForumTopic.find(query);
        res.json(serializeMediaUrls(topics, res.req));
    } catch (error) {
        res.status(500).json(serializeMediaUrls({ message: error.message }, res.req));
    }
});

// GET single topic
router.get('/:id', async (req, res) => {
    try {
        const ForumTopic = mongoose.model('ForumTopic');
        let topic;

        if (mongoose.Types.ObjectId.isValid(req.params.id)) {
            topic = await ForumTopic.findById(req.params.id);
        }

        if (!topic) return res.status(404).json(serializeMediaUrls({ message: 'Konu bulunamadı' }, res.req));

        // Increase views
        topic.views += 1;
        await topic.save();

        res.json(serializeMediaUrls(topic, res.req));
    } catch (error) {
        res.status(500).json(serializeMediaUrls({ message: error.message }, res.req));
    }
});

// POST new topic
router.post('/', async (req, res) => {
    try {
        const ForumTopic = mongoose.model('ForumTopic');
        const newTopic = new ForumTopic(req.body);
        await newTopic.save();
        res.status(201).json(serializeMediaUrls(newTopic, res.req));
    } catch (error) {
        res.status(400).json(serializeMediaUrls({ message: error.message }, res.req));
    }
});

// POST comment to topic
router.post('/:id/comments', async (req, res) => {
    try {
        const ForumTopic = mongoose.model('ForumTopic');
        const { content, authorId, authorName } = req.body;

        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json(serializeMediaUrls({ message: 'Geçersiz ID' }, res.req));
        }

        const topic = await ForumTopic.findById(req.params.id);
        if (!topic) return res.status(404).json(serializeMediaUrls({ message: 'Konu bulunamadı' }, res.req));

        const newComment = {
            _id: new mongoose.Types.ObjectId(), // Let Mongoose generate ID, or manually if schema strict
            content,
            authorId,
            authorName,
            date: new Date().toLocaleDateString('tr-TR'),
            likes: 0
        };

        topic.comments.push(newComment);
        await topic.save();
        res.status(201).json(serializeMediaUrls(topic, res.req));
    } catch (error) {
        res.status(400).json(serializeMediaUrls({ message: error.message }, res.req));
    }
});

// PUT like topic
router.put('/:id/like', async (req, res) => {
    try {
        const ForumTopic = mongoose.model('ForumTopic');
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json(serializeMediaUrls({ message: 'Geçersiz ID' }, res.req));
        }

        const topic = await ForumTopic.findById(req.params.id);
        if (!topic) return res.status(404).json(serializeMediaUrls({ message: 'Konu bulunamadı' }, res.req));

        topic.likes += 1;
        await topic.save();
        res.json(serializeMediaUrls(topic, res.req));
    } catch (error) {
        res.status(400).json(serializeMediaUrls({ message: error.message }, res.req));
    }
});

export default router;
