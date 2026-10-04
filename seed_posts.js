
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Post from './models/Post.js';
import User from './models/User.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) throw new Error('MONGO_URI ortam degiskeni zorunludur.');

const seedPosts = async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('✅ MongoDB Connected');

        // Find Admin User
        const admin = await User.findOne({ email: '111@111' });
        if (!admin) {
            console.error('❌ Admin user not found. Please run server.js first.');
            process.exit(1);
        }

        console.log('🧹 Clearing existing posts...');
        await Post.deleteMany({});

        console.log('🌱 Seeding posts...');

        const posts = [
            {
                user: admin._id,
                userName: admin.name || 'MotoVibe Admin',
                userAvatar: 'https://images.unsplash.com/photo-1599566150163-29194dcaad36?q=80&w=200&auto=format&fit=crop',
                userRank: 'Pro Rider',
                caption: 'Pazar sabahı viraj keyfi 🏍️💨 #motovibe #yamaha #r25',
                content: 'Pazar sabahı viraj keyfi 🏍️💨 #motovibe #yamaha #r25',
                media: [
                    {
                        url: 'https://images.unsplash.com/photo-1558981285-6f0c94958bb6?q=80&w=800&auto=format&fit=crop',
                        type: 'IMAGE'
                    }
                ],
                likes: [],
                likeCount: 42,
                commentCount: 5,
                location: 'Şile Yolu',
                telemetry: {
                    speed: 124,
                    leanAngle: 45
                },
                createdAt: new Date().toISOString()
            },
            {
                user: admin._id,
                userName: admin.name || 'MotoVibe Admin',
                userAvatar: 'https://images.unsplash.com/photo-1599566150163-29194dcaad36?q=80&w=200&auto=format&fit=crop',
                userRank: 'Pro Rider',
                caption: 'Yeni ekipmanlarımı deniyorum. Kask muazzam! 🔥',
                content: 'Yeni ekipmanlarımı deniyorum. Kask muazzam! 🔥',
                media: [
                    {
                        url: 'https://images.unsplash.com/photo-1609630875171-b1321377ee65?q=80&w=800&auto=format&fit=crop',
                        type: 'IMAGE'
                    }
                ],
                likes: [],
                likeCount: 128,
                commentCount: 14,
                location: 'İstanbul Park',
                createdAt: new Date(Date.now() - 86400000).toISOString() // 1 day ago
            },
            {
                user: admin._id,
                userName: admin.name || 'MotoVibe Admin',
                userAvatar: 'https://images.unsplash.com/photo-1599566150163-29194dcaad36?q=80&w=200&auto=format&fit=crop',
                userRank: 'Pro Rider',
                caption: 'Gece sürüşü terapisi 🌃',
                content: 'Gece sürüşü terapisi 🌃',
                media: [
                    {
                        url: 'https://images.unsplash.com/photo-1605152276897-4f618f831968?q=80&w=800&auto=format&fit=crop',
                        type: 'IMAGE'
                    }
                ],
                likes: [],
                likeCount: 89,
                commentCount: 3,
                location: '15 Temmuz Şehitler Köprüsü',
                createdAt: new Date(Date.now() - 172800000).toISOString() // 2 days ago
            }
        ];

        await Post.insertMany(posts);
        console.log('✅ Posts seeded successfully!');

        process.exit(0);
    } catch (error) {
        console.error('❌ Seeding failed:', error);
        process.exit(1);
    }
};

seedPosts();
