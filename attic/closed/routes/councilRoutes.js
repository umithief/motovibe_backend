import { serializeMediaUrls } from "../../../utils/serializeMediaUrls.js";
import express from 'express';
import mongoose from 'mongoose';
import { protect } from "../../../middleware/authMiddleware.js";
import "../../../models/Thread.js";
import "../../../models/Reply.js";

const router = express.Router();

const Thread = mongoose.model('Thread');
const Reply = mongoose.model('Reply');

// GET all threads (with optional filters: category, trending, etc.)
router.get('/threads', async (req, res) => {
    try {
        const { filter, category, page = 1, limit = 20 } = req.query;
        let query = {};
        
        if (category && category !== 'Tümü' && category !== 'Hepsi') {
            query.category = category.toUpperCase();
        }

        let sortOption = { createdAt: -1 }; // Default new
        if (filter === 'trending') {
            sortOption = { revScore: -1, createdAt: -1 };
        } else if (filter === 'unresolved') {
            query.isResolved = false;
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const threads = await Thread.find(query)
            .sort(sortOption)
            .skip(skip)
            .limit(parseInt(limit))
            .populate('author', 'name avatar role')
            .populate('linkedBike', 'brand model year');
            
        // Calculate total for pagination
        const total = await Thread.countDocuments(query);

        res.json(serializeMediaUrls({
            status: 'success',
            data: threads,
            page: parseInt(page),
            pages: Math.ceil(total / parseInt(limit)),
            total
        }, res.req));
    } catch (error) {
        res.status(500).json(serializeMediaUrls({ status: 'error', message: error.message }, res.req));
    }
});

// GET single thread details
router.get('/threads/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json(serializeMediaUrls({ status: 'error', message: 'Geçersiz ID' }, res.req));
        }
        const thread = await Thread.findById(req.params.id)
            .populate('author', 'name avatar role')
            .populate('linkedBike', 'brand model year');
            
        if (!thread) return res.status(404).json(serializeMediaUrls({ status: 'error', message: 'Konu bulunamadı' }, res.req));
        
        res.json(serializeMediaUrls({ status: 'success', data: thread }, res.req));
    } catch (error) {
        res.status(500).json(serializeMediaUrls({ status: 'error', message: error.message }, res.req));
    }
});

// GET replies for a thread
router.get('/threads/:id/replies', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json(serializeMediaUrls({ status: 'error', message: 'Geçersiz ID' }, res.req));
        }
        
        const replies = await Reply.find({ threadId: req.params.id })
            .sort({ isAcceptedSolution: -1, revScore: -1, createdAt: 1 }) // Accepted first, then highest score
            .populate('author', 'name avatar role isPro');
            
        res.json(serializeMediaUrls({ status: 'success', data: replies }, res.req));
    } catch (error) {
        res.status(500).json(serializeMediaUrls({ status: 'error', message: error.message }, res.req));
    }
});

// POST a new thread
router.post('/threads', protect, async (req, res) => {
    try {
        const body = { ...req.body };
        body.author = req.user._id; // Enforce logged in user as author
        if (body.linkedBike && !mongoose.Types.ObjectId.isValid(body.linkedBike)) {
            body.linkedBike = undefined;
        }
        const newThread = new Thread(body);
        await newThread.save();
        const populatedThread = await Thread.findById(newThread._id)
            .populate('author', 'name avatar role')
            .populate('linkedBike', 'brand model year');
        res.status(201).json(serializeMediaUrls({ status: 'success', data: populatedThread }, res.req));
    } catch (error) {
        res.status(400).json(serializeMediaUrls({ status: 'error', message: error.message }, res.req));
    }
});

// POST a new reply
router.post('/threads/:id/replies', protect, async (req, res) => {
    try {
        const { body } = req.body;
        const threadId = req.params.id;
        
        if (!body || !body.trim()) {
            return res.status(400).json(serializeMediaUrls({ status: 'error', message: 'Yanıt içeriği zorunludur.' }, res.req));
        }

        const newReply = new Reply({
            threadId,
            author: req.user._id,
            body: body.trim()
        });
        await newReply.save();
        
        // Also increment reply count
        await Thread.findByIdAndUpdate(threadId, { $inc: { replyCount: 1 } });
        
        const populatedReply = await Reply.findById(newReply._id)
            .populate('author', 'name avatar role isPro');
            
        res.status(201).json(serializeMediaUrls({ status: 'success', data: populatedReply }, res.req));
    } catch (error) {
        res.status(400).json(serializeMediaUrls({ status: 'error', message: error.message }, res.req));
    }
});

// POST vote for thread or reply
router.post('/vote', protect, async (req, res) => {
    try {
        const { targetId, type, value } = req.body; // value: 1 or -1 or 0
        
        let targetModel;
        if (type === 'thread') {
            targetModel = Thread;
        } else if (type === 'reply') {
            targetModel = Reply;
        } else {
            return res.status(400).json(serializeMediaUrls({ status: 'error', message: 'Geçersiz tip' }, res.req));
        }
        
        const document = await targetModel.findById(targetId);
        if (!document) return res.status(404).json(serializeMediaUrls({ status: 'error', message: 'Kayıt bulunamadı' }, res.req));
        
        const voteDelta = Math.max(-1, Math.min(1, parseInt(value) || 0));
        document.revScore = (document.revScore || 0) + voteDelta;
        await document.save();
        
        res.json(serializeMediaUrls({ status: 'success', newScore: document.revScore }, res.req));
    } catch (error) {
        res.status(500).json(serializeMediaUrls({ status: 'error', message: error.message }, res.req));
    }
});

// POST accept solution
router.post('/threads/:threadId/accept', protect, async (req, res) => {
    try {
        const { threadId } = req.params;
        const { replyId } = req.body;
        
        const thread = await Thread.findById(threadId);
        if (!thread) return res.status(404).json(serializeMediaUrls({ status: 'error', message: 'Konu bulunamadı' }, res.req));

        const isAuthor = thread.author.toString() === req.user._id.toString();
        if (!isAuthor && !req.user.isAdmin) {
            return res.status(403).json(serializeMediaUrls({ status: 'error', message: 'Yalnızca konuyu açan sürücü çözümü işaretleyebilir.' }, res.req));
        }

        // Mark thread as resolved
        thread.isResolved = true;
        await thread.save();
        
        // Reset old accepted solution if any, and set the new one
        await Reply.updateMany({ threadId }, { isAcceptedSolution: false });
        await Reply.findByIdAndUpdate(replyId, { isAcceptedSolution: true });
        
        res.json(serializeMediaUrls({ status: 'success', message: 'Kesin çözüm işaretlendi' }, res.req));
    } catch (error) {
        res.status(500).json(serializeMediaUrls({ status: 'error', message: error.message }, res.req));
    }
});

export default router;
