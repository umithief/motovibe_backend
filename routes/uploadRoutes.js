import crypto from 'crypto';
import express from 'express';
import { mkdir, writeFile } from 'fs/promises';
import multer from 'multer';
import path from 'path';
import { protect } from '../middleware/authMiddleware.js';
import AppError from '../utils/appError.js';
import catchAsync from '../utils/catchAsync.js';

const router = express.Router();
const uploadDirectory = path.resolve(process.cwd(), 'uploads');
const allowedTypes = new Map([
    ['image/jpeg', '.jpg'],
    ['image/jpg', '.jpg'],
    ['image/png', '.png'],
    ['image/webp', '.webp'],
    ['image/heic', '.heic'],
    ['image/heif', '.heif'],
    ['image/gif', '.gif'],
    ['audio/mpeg', '.mp3'],
    ['audio/mp3', '.mp3'],
    ['audio/mp4', '.m4a'],
    ['audio/m4a', '.m4a'],
    ['audio/x-m4a', '.m4a'],
    ['audio/aac', '.aac'],
    ['audio/wav', '.wav'],
    ['audio/ogg', '.ogg'],
    ['audio/webm', '.webm'],
    ['video/mp4', '.mp4'],
    ['video/quicktime', '.mov'],
    ['video/x-m4v', '.m4v'],
    ['video/webm', '.webm'],
]);

const configuredMaxBytes = Number.parseInt(process.env.UPLOAD_MAX_BYTES, 10);
const maxBytes = Number.isSafeInteger(configuredMaxBytes) && configuredMaxBytes > 0
    ? configuredMaxBytes
    : 100 * 1024 * 1024; // Increased default to 100MB to accommodate video

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 10 },
    fileFilter: (req, file, callback) => {
        if (!allowedTypes.has(file.mimetype)) {
            // Also check file extension if mimetype is generic octet-stream or unrecognized
            const ext = path.extname(file.originalname).toLowerCase();
            const allowedExts = ['.m4a', '.mp3', '.aac', '.wav', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.gif', '.dng', '.mp4', '.mov', '.m4v'];
            if (allowedExts.includes(ext)) {
                return callback(null, true);
            }
            console.error('Upload rejected. Mimetype:', file.mimetype, 'Ext:', ext);
            return callback(new AppError(`Desteklenmeyen dosya formatı. Mimetype: ${file.mimetype}, Ext: ${ext}`, 422));
        }
        return callback(null, true);
    },
});

const receiveSingleFile = (req, res, next) => {
    upload.single('file')(req, res, (error) => {
        if (!error) return next();
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
            return next(new AppError(`Dosya boyutu en fazla ${maxBytes} byte olabilir.`, 413));
        }
        return next(error);
    });
};

router.post('/', protect, receiveSingleFile, catchAsync(async (req, res, next) => {
    if (!req.file) {
        return next(new AppError('file alanında bir dosya zorunludur.', 400));
    }

    let extension = allowedTypes.get(req.file.mimetype);
    if (!extension) {
        extension = path.extname(req.file.originalname).toLowerCase() || '.bin';
    }

    const isAudio = req.file.mimetype.startsWith('audio') || extension === '.m4a' || extension === '.mp3' || extension === '.wav';
    const isVideo = req.file.mimetype.startsWith('video') || extension === '.mp4' || extension === '.mov' || extension === '.m4v';
    const prefix = isAudio ? 'voice' : (isVideo ? 'video' : 'img');
    const fileName = `${prefix}-${Date.now()}-${crypto.randomUUID()}${extension}`;
    await mkdir(uploadDirectory, { recursive: true });
    await writeFile(path.join(uploadDirectory, fileName), req.file.buffer, { flag: 'wx' });

    return res.status(201).json({
        success: true,
        url: `uploads/${fileName}`,
    });
}));

export default router;
