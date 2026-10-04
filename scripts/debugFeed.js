
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Post from '../models/Post.js';
import User from '../models/User.js';

dotenv.config();

// Ensure Post model is registered if not already
if (!mongoose.models.Post) {
    // Basic definition to avoid MissingSchemaError if model file isn't loaded
    console.warn('⚠️ Manual Post Schema Definition used for debug script');
    const postSchema = new mongoose.Schema({
        content: String,
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        createdAt: { type: Date, default: Date.now },
        likeCount: { type: Number, default: 0 }
    });
    mongoose.model('Post', postSchema);
}
// Ensure User model is registered
if (!mongoose.models.User) {
    const userSchema = new mongoose.Schema({
        username: String,
        name: String
    });
    mongoose.model('User', userSchema);
}


const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) throw new Error('MONGO_URI ortam degiskeni zorunludur.');

const checkPosts = async () => {
    console.log('\n🔎 INSPECTING POSTS DATABASE...\n');

    try {
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected.');

        // 1. Count Total Posts
        const total = await Post.countDocuments();
        console.log(`\nTotal Posts in DB: ${total}`);

        if (total === 0) {
            console.log('❌ Database is empty. No posts found.');
            process.exit(0);
        }

        // 2. List All Posts (Limit 20)
        // Manual population to be safe against schema mismatches
        const posts = await Post.find()
            .sort({ createdAt: -1 })
            .limit(20);

        console.log('\nRecent Posts:');
        console.log('-------------------------------------------------------------------------');
        console.log('ID                       | Author               | Date (Days Ago) | Likes');
        console.log('-------------------------------------------------------------------------');

        for (const p of posts) {
            let authorName = 'UNKNOWN';
            if (p.user) {
                const user = await User.findById(p.user);
                authorName = user ? user.username : 'DELETED_USER';
            }

            const daysAgo = ((Date.now() - new Date(p.createdAt).getTime()) / (1000 * 60 * 60 * 24)).toFixed(1);
            console.log(`${p._id} | ${pad(authorName, 20)} | ${pad(daysAgo, 15)} | ${p.likeCount}`);
        }

        console.log('-------------------------------------------------------------------------');

        // 3. Check Date Filter Impact
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const validPosts = await Post.countDocuments({ createdAt: { $gte: sevenDaysAgo } });
        console.log(`\n📉 Posts created in last 7 days (Visible in Feed): ${validPosts} / ${total}`);

        if (validPosts === 0) {
            console.log('⚠️  REASON FOUND: All posts are older than 7 days. The feed filters them out.');
        } else if (validPosts === total) {
            console.log('✅ Date filter is not the issue. Checking potential user blocks or score issues.');
        }

    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
};

const pad = (str, len) => (str || '').toString().padEnd(len, ' ');

checkPosts();
