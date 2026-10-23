import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Achievement from './models/Achievement.js';
import User from './models/User.js';
import { defaultAchievements } from './data/achievements.js';
import { calculateRankAndLevel } from './services/achievementEngine.js';

dotenv.config();

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('Connected to MongoDB');
    
    // Clear old achievements
    await Achievement.deleteMany({});
    console.log('Old achievements deleted');
    
    for (const ach of defaultAchievements) {
        await Achievement.create(ach);
    }
    console.log(`Seed completed: ${defaultAchievements.length} achievements created.`);

    // Recalculate ranks for existing users
    const users = await User.find({});
    let updatedCount = 0;
    for (const u of users) {
      const { rank: newRank } = calculateRankAndLevel(u.points || 0);
      if (u.rank !== newRank) {
        console.log(`[Rank Update] ${u.username || u.name || u._id}: "${u.rank}" -> "${newRank}"`);
        u.rank = newRank;
        await u.save({ validateBeforeSave: false });
        updatedCount++;
      }
    }
    console.log(`User ranks updated: ${updatedCount} users updated.`);
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
