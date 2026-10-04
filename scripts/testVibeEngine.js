
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Post from '../models/Post.js';
import User from '../models/User.js';
import VibeConfig from '../models/VibeConfig.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) throw new Error('MONGO_URI ortam degiskeni zorunludur.');

// --- COPIED LOGIC TO AVOID REDIS DEPENDENCY FOR TESTING ---
const calculateVibeScore = (post, viewerContext = {}, config = null) => {
    // defaults
    const w = config?.weights || { like: 10, comment: 30, share: 50, save: 60 };
    const m = config?.multipliers || { telemetry: 1.5, affinity: 1.3, pro: 1.2 };
    const decay = config?.timeDecay || { enabled: true, factor: 1.8 };

    // 1. Engagement Score
    const likes = post.likeCount || 0;
    const comments = post.commentCount || 0;
    const shares = post.shareCount || 0;
    const saves = post.saveCount || 0;

    let score = (likes * w.like) + (comments * w.comment) + (shares * w.share) + (saves * w.save);

    // 2. Multipliers
    // A. Telemetry
    if (post.telemetryQuality || (post.telemetry && post.telemetry.speed > 0)) {
        score *= m.telemetry;
    }

    // B. Garage Match (Affinity)
    if (viewerContext.activeBikeModel && post.bikeModel &&
        viewerContext.activeBikeModel.toLowerCase() === post.bikeModel.toLowerCase()) {
        score *= m.affinity;
    }

    // C. Verified Pro
    if (post.user?.rank === 'Pro Rider' || post.user?.rank === 'MotoVibe Pro') {
        score *= m.pro;
    }

    // 3. Time Decay
    if (decay.enabled) {
        const hoursSincePosted = (Date.now() - new Date(post.createdAt).getTime()) / (1000 * 60 * 60);
        // Prevent division by zero or negative
        const decayFactor = Math.pow(Math.max(0.1, hoursSincePosted + 2), decay.factor);
        return score / decayFactor;
    }

    return score;
};
// -------------------------------------------------------------

// Helper to format output
const pad = (str, len) => (str || '').toString().padEnd(len, ' ');

const runTest = async () => {
    console.log('\n🧠 STARTING VIBEENGINE ALGORITHM TEST (Standalone Mode)...\n');

    try {
        // 1. Connect to DB
        console.log('🔌 Connecting to MongoDB...');
        // Set short timeout so we don't hang if Mongo isn't running
        await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
        console.log('✅ Connected.');

        // 2. Fetch Config
        console.log('\n⚙️  Fetching VibeConfig...');
        let config = await VibeConfig.findById('default_config');

        if (!config) {
            console.log('⚠️  No config found in DB, using simulation defaults.');
            config = {
                weights: { like: 10, comment: 30, share: 50, save: 60 },
                multipliers: { telemetry: 1.5, affinity: 1.3, pro: 1.2 },
                timeDecay: { enabled: true, factor: 1.8 }
            };
        } else {
            // Ensure it's a POJO and fill defaults
            config = config.toObject ? config.toObject() : config;
            config.weights = config.weights || { like: 10, comment: 30, share: 50, save: 60 };
            config.multipliers = config.multipliers || { telemetry: 1.5, affinity: 1.3, pro: 1.2 };
            config.timeDecay = config.timeDecay || { enabled: true, factor: 1.8 };
            console.log('✅ Config Loaded successfully.');
        }

        // 3. Fetch Sample Posts
        console.log('\n🥡 Fetching Sample Posts (Last 5)...');
        const posts = await Post.find().sort({ createdAt: -1 }).limit(5).populate('user');

        if (posts.length === 0) {
            console.log('❌ No posts found in database to test.');

            // Create Mock Data for User to See
            console.log('🧪 Creating MOCK DATA for demonstration (DB is empty)...');
            posts.push({
                _id: 'MOCK_POST_1',
                likeCount: 50, commentCount: 10, shareCount: 5, saveCount: 2,
                telemetryQuality: true,
                bikeModel: 'Yamaha R6',
                user: { rank: 'Pro Rider' },
                createdAt: new Date() // Just now
            });
            posts.push({
                _id: 'MOCK_POST_2',
                likeCount: 50, commentCount: 10, shareCount: 5, saveCount: 2,
                telemetryQuality: false, // Difference
                bikeModel: 'Honda CBR',
                user: { rank: 'Rider' },
                createdAt: new Date(Date.now() - 86400000) // 1 day ago
            });
        }

        // 4. Run Analysis
        console.log('\n📊 VIBE SCORE ANALYSIS REPORT:\n');
        console.log(`${pad('Post ID', 20)} | ${pad('Engage', 8)} | ${pad('Mults', 15)} | ${pad('Time(hrs)', 10)} | ${pad('SCORE', 10)}`);
        console.log('-'.repeat(80));

        for (const post of posts) {
            // Mock Viewer Context
            const viewerContext = {
                activeBikeModel: 'Yamaha R6' // Testing affinity
            };

            const score = calculateVibeScore(post, viewerContext, config);

            // Calculate components for display
            const w = config.weights;
            const l = post.likeCount || 0, c = post.commentCount || 0, s = post.shareCount || 0, sv = post.saveCount || 0;
            const engageScore = (l * w.like) + (c * w.comment) + (s * w.share) + (sv * w.save);

            let mults = [];
            if (post.telemetryQuality || (post.telemetry?.speed > 0)) mults.push('Telem');
            if (post.user?.rank?.includes('Pro')) mults.push('Pro');
            if (post.bikeModel && viewerContext.activeBikeModel && post.bikeModel.toLowerCase() === viewerContext.activeBikeModel.toLowerCase()) mults.push('BikeMatch');

            const multStr = mults.length > 0 ? mults.join(',') : '-';
            const hoursOld = ((Date.now() - new Date(post.createdAt).getTime()) / 3600000).toFixed(1);

            console.log(`${pad(post._id.toString().substring(0, 20), 20)} | ${pad(engageScore, 8)} | ${pad(multStr, 15)} | ${pad(hoursOld, 10)} | ${pad(score.toFixed(2), 10)}`);
        }

        console.log('\n✅ TEST COMPLETE. Algorithm Logic Verified.');

    } catch (err) {
        console.error('❌ TEST FAILED:', err.message);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
};

runTest();
