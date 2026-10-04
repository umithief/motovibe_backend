import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

// Import models
import '../models/User.js';
import '../models/Achievement.js';
import '../models/Notification.js';

import {
    ensureDefaultAchievements,
    setMaxMetric,
    evaluateAndUnlock
} from '../services/achievementEngine.js';

const User = mongoose.model('User');
const Achievement = mongoose.model('Achievement');
const Notification = mongoose.model('Notification');

async function runE2ESmoke() {
    console.log('🚀 --- STARTING TRI-SURFACE ACHIEVEMENT SMOKE TEST (UNLOCK -> ODA + PROFİL + BİO) --- 🚀\n');

    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/motovibe';
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
    console.log('✅ Connected to MongoDB.');

    await ensureDefaultAchievements();
    const targetAch = await Achievement.findOne({ slug: 'viraj_ustasi' }).lean();
    console.assert(targetAch, 'Viraj Ustası achievement must exist in DB');
    console.log(`📌 Target Achievement: "${targetAch.title}" (ID: ${targetAch._id}, required: ${targetAch.requiredValue}°)`);

    // Create test user with a bio block referencing this achievement
    const testUsername = `apex_pilot_${Date.now()}`;
    const testUser = await User.create({
        name: 'Apex Pilot',
        username: testUsername,
        email: `${testUsername}@motovibe.app`,
        password: 'Password123!',
        points: 0,
        bioBlocks: [
            {
                id: 'block_badge_1',
                type: 'achievementBadge',
                data: {
                    achievementId: targetAch._id.toString(),
                    title: targetAch.title,
                    subtitle: targetAch.description,
                    metric: `${targetAch.requiredValue} ${targetAch.unit}`,
                    rank: targetAch.badgeType
                }
            }
        ]
    });

    console.log(`👤 User created: ${testUser.username} (${testUser._id})`);

    // Step 1: Pre-unlock verification
    console.log('\n1️⃣ [Stage 1: Pre-Unlock Checks]');
    const userBefore = await User.findById(testUser._id);
    const isUnlockedBefore = (userBefore.unlockedAchievements || []).some(id => id.toString() === targetAch._id.toString());
    console.assert(!isUnlockedBefore, 'Achievement should initially be locked');
    console.log('   🔒 Achievement is locked across all surfaces.');

    // Step 2: Trigger Ride Telemetry Unlock (54° Lean)
    console.log('\n2️⃣ [Stage 2: Triggering Ride Telemetry Unlock (54° Lean)]');
    await setMaxMetric(testUser._id, 'maxLeanAngle', 54);
    await evaluateAndUnlock(testUser._id);

    const userAfter = await User.findById(testUser._id);
    const isUnlockedAfter = (userAfter.unlockedAchievements || []).some(id => id.toString() === targetAch._id.toString());
    console.assert(isUnlockedAfter, 'Achievement must be unlocked in user record');
    console.log('   🎉 Achievement successfully unlocked in DB!');

    // Step 3: Room Surface (GET /achievements/all)
    console.log('\n3️⃣ [Stage 3: Oda Doğrulaması (GET /users/achievements/all)]');
    const allAchievements = await Achievement.find().lean();
    const unlockedSet = new Set((userAfter.unlockedAchievements || []).map(id => id.toString()));
    const odaBadge = allAchievements.find(a => a._id.toString() === targetAch._id.toString());
    console.assert(odaBadge && unlockedSet.has(odaBadge._id.toString()), 'Oda endpoint must return achievement with isUnlocked=true');
    console.log(`   🏛️  Oda: "${odaBadge.title}" (ID: ${odaBadge._id}) -> isUnlocked = true, Category = ${odaBadge.category}, Badge = ${odaBadge.badgeType}`);

    // Step 4: Profil Özeti (GET /users/me & GET /users/profile/:id)
    console.log('\n4️⃣ [Stage 4: Profil Özeti Doğrulaması (GET /users/profile/:id & GET /users/me)]');
    const profileBadges = await Achievement.find({ _id: { $in: userAfter.unlockedAchievements } }).lean();
    const profileTrophy = profileBadges.find(b => b._id.toString() === targetAch._id.toString());
    console.assert(profileTrophy, 'Profil trophyBadges must contain target achievement');
    console.assert(profileTrophy.title === odaBadge.title, 'Profil and Oda title must be identical');
    console.assert(profileTrophy.badgeType === odaBadge.badgeType, 'Profil and Oda badgeType must be identical');
    console.log(`   🏆 Profil Özeti: "${profileTrophy.title}" (ID: ${profileTrophy._id}) -> Badge = ${profileTrophy.badgeType}`);

    // Step 5: Bio Bloğu Doğrulaması (Bio Renderer & Studio)
    console.log('\n5️⃣ [Stage 5: Bio Vitrini Doğrulaması (Bio Block Data)]');
    const bioBlock = userAfter.bioBlocks[0];
    console.assert(bioBlock.data.achievementId === targetAch._id.toString(), 'Bio achievementId must match unlocked achievement ID');
    console.assert(bioBlock.data.title === profileTrophy.title, 'Bio badge title must match profile trophy title');
    console.assert(bioBlock.data.rank === profileTrophy.badgeType, 'Bio rank must match badgeType');
    console.log(`   ✨ Bio Vitrini: "${bioBlock.data.title}" (ID: ${bioBlock.data.achievementId}) -> Aktif ve eşleşti!`);

    // Step 6: Bildirim Doğrulaması
    console.log('\n6️⃣ [Stage 6: Bildirim Kutusu (ACHIEVEMENT_UNLOCKED)]');
    const notifications = await Notification.find({ recipient: testUser._id, type: 'ACHIEVEMENT_UNLOCKED' });
    console.assert(notifications.length > 0, 'Notification should be delivered');
    console.log(`   🔔 In-app notification: "${notifications[0].text}"`);

    // Cleanup
    await User.deleteOne({ _id: testUser._id });
    await Notification.deleteMany({ recipient: testUser._id });
    await mongoose.disconnect();
    console.log('\n🧹 Test verisi temizlendi.');
    console.log('🏁 --- ODA, PROFİL VE BİO YÜZEYLERİNDE ROZET BİREBİR EŞLEŞTİ VE TEST BAŞARIYLA TAMAMLANDI --- 🏁');
}

runE2ESmoke().catch(err => {
    console.error('Fatal E2E Smoke Error:', err);
    process.exit(1);
});
