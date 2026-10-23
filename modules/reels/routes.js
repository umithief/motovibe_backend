import os from 'os';
import express from 'express';
import multer from 'multer';
import path from 'path';
import AppError from "../../utils/appError.js";
import { admin, checkUser, protect } from "../../middleware/authMiddleware.js";
import {
    createReel,
    getReelById,
    getReels,
    adminGetReels,
    updateReelStatus,
    deleteReel,
    interactReel,
    getReelComments,
    addReelComment,
    getUserReels,
    getSavedReels,
    updateReel,
    deleteReelComment,
} from "./controller.js";

const router = express.Router();

// Multer Setup for Video
const storage = multer.memoryStorage();

const upload = multer({
    storage: storage,
    limits: { fileSize: 80 * 1024 * 1024 }, // 80MB limit
    fileFilter: (req, file, cb) => {
        const videoTypes = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'];
        const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];

        if (file.fieldname === 'video') {
            if (!videoTypes.includes(file.mimetype)) {
                return cb(new Error('Video formati desteklenmiyor. MP4/MOV/WEBM kullanin.'));
            }
            return cb(null, true);
        }

        if (file.fieldname === 'thumbnail') {
            if (!imageTypes.includes(file.mimetype)) {
                return cb(new Error('Thumbnail formati desteklenmiyor. JPG/PNG/WEBP kullanin.'));
            }
            return cb(null, true);
        }

        return cb(new Error('Geçersiz yukleme alani.'));
    },
});

const uploadReelMedia = (req, res, next) => {
    const uploader = upload.fields([
        { name: 'video', maxCount: 1 },
        { name: 'thumbnail', maxCount: 1 }
    ]);

    uploader(req, res, (err) => {
        if (!err) return next();

        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return next(new AppError('Dosya boyutu en fazla 80MB olabilir.', 400));
            }
            return next(new AppError(err.message, 400));
        }

        return next(new AppError(err.message || 'Dosya yukleme hatasi.', 400));
    });
};

// Public / User Routes
router.get('/', checkUser, getReels);
router.get('/saved', protect, getSavedReels);
router.get('/user/:userId', checkUser, getUserReels);
router.get('/:id', checkUser, getReelById);
router.post('/upload', protect, uploadReelMedia, createReel);
router.post('/:id/interact', checkUser, interactReel);
router.get('/:id/comments', getReelComments);
router.post('/:id/comments', protect, addReelComment);
router.delete('/:id/comments/:commentId', protect, deleteReelComment);
router.put('/:id', protect, updateReel);
router.delete('/:id', protect, deleteReel);

router.get('/admin/all', protect, admin, adminGetReels);
router.patch('/admin/:id', protect, admin, updateReelStatus);
router.delete('/admin/:id', protect, admin, deleteReel);

export default router;
