import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';

import Post from "../modules/posts/model.js";
import Reel from "../modules/reels/model.js";

test('post media keeps bounded image dimensions and aspect ratio', () => {
    const post = new Post({
        user: new mongoose.Types.ObjectId(),
        media: [{
            url: 'uploads/landscape.jpg',
            type: 'IMAGE',
            width: 1600,
            height: 900,
            aspectRatio: 16 / 9,
        }],
    });

    assert.equal(post.validateSync(), undefined);
    assert.equal(post.media[0].width, 1600);
    assert.equal(post.media[0].height, 900);
    assert.ok(Math.abs(post.media[0].aspectRatio - (16 / 9)) < 0.0001);
});

test('post media rejects invalid aspect ratio metadata', () => {
    const post = new Post({
        user: new mongoose.Types.ObjectId(),
        media: [{
            url: 'uploads/broken.jpg',
            type: 'IMAGE',
            width: 0,
            height: -1,
            aspectRatio: 100,
        }],
    });

    const validationError = post.validateSync();
    assert.ok(validationError);
    assert.match(validationError.message, /media/);
});

test('reel keeps thumbnail dimensions for feed layout stability', () => {
    const reel = new Reel({
        userId: new mongoose.Types.ObjectId().toString(),
        videoUrl: 'uploads/reel.mp4',
        thumbnailUrl: 'uploads/reel-cover.jpg',
        thumbnailWidth: 1080,
        thumbnailHeight: 1920,
        thumbnailAspectRatio: 1080 / 1920,
    });

    assert.equal(reel.validateSync(), undefined);
    assert.equal(reel.thumbnailWidth, 1080);
    assert.equal(reel.thumbnailHeight, 1920);
    assert.ok(Math.abs(reel.thumbnailAspectRatio - (1080 / 1920)) < 0.0001);
});

test('isValidVideoStorageUrl accepts local uploads, motovibe CDN and rejects arbitrary untrusted URLs', async () => {
    const { isValidVideoStorageUrl } = await import("../modules/reels/controller.js");

    // Valid uploads and local paths
    assert.equal(isValidVideoStorageUrl('uploads/reel-12345.mp4'), true);
    assert.equal(isValidVideoStorageUrl('/uploads/reel-12345.mp4'), true);
    assert.equal(isValidVideoStorageUrl('https://31.210.36.57/uploads/video.mp4'), true);
    assert.equal(isValidVideoStorageUrl('https://motovibe.app/uploads/video.mp4'), true);
    assert.equal(isValidVideoStorageUrl('https://cdn.motovibe.app/reels/video.mp4'), true);
    assert.equal(isValidVideoStorageUrl('http://10.0.2.2:5000/uploads/video.mp4'), true);

    // Untrusted external sources
    assert.equal(isValidVideoStorageUrl('https://malicious-site.com/video.mp4'), false);
    assert.equal(isValidVideoStorageUrl('https://evil.org/exploit.mp4'), false);
    assert.equal(isValidVideoStorageUrl('javascript:alert(1)'), false);
    assert.equal(isValidVideoStorageUrl(''), false);
    assert.equal(isValidVideoStorageUrl(null), false);
});
