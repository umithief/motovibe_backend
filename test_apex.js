import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import User from './models/User.js';
import { recordMaxLeanAngle, addWeeklyDistance, fetchLeaderboard } from './services/leaderboardService.js';
import redis from './config/redis.js';

async function runTest() {
    try {
        const mongoUri = process.env.MONGO_URI;
        if (!mongoUri) throw new Error('MONGO_URI ortam degiskeni zorunludur.');
        await mongoose.connect(mongoUri);
        console.log('✅ MongoDB connected.');
        
        // Wait for Redis to be ready
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Find test users
        const user1 = await User.findOne({ username: 'ishak_admin' });
        const user2 = await User.findOne({ username: 'admin' });

        if (!user1 || !user2) {
            console.log("⚠️ Test users not found, check DB seed.");
            process.exit(1);
        }

        console.log(`📈 Adding mock telemetry for ${user1.username} and ${user2.username}...`);
        
        // Fake telemetry payload insertion
        await recordMaxLeanAngle(user1._id.toString(), 48.5);  // Fake 48.5 deg
        await recordMaxLeanAngle(user2._id.toString(), 35.2);  // Fake 35.2 deg
        
        await addWeeklyDistance(user1._id.toString(), 125);
        await addWeeklyDistance(user2._id.toString(), 340);

        console.log('✅ Telemetry test data injected to Redis.');

        // Test fetching to ensure backend works
        console.log('\n📊 Fetching "Viraj" Leaderboard:');
        const leanBoard = await fetchLeaderboard({ category: 'lean' });
        console.log(JSON.stringify(leanBoard.entries, null, 2));

        console.log('\n✅ TEST BAŞARILI. Telefondan "Apex Board" -> "Viraj" sekmesine girip sonuçları görebilirsiniz.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error during test:', error);
        process.exit(1);
    }
}

runTest();
