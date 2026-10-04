import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    const db = mongoose.connection.db;
    const countTotal = await db.collection('rides').countDocuments();
    const countWithDist = await db.collection('rides').countDocuments({ 'stats.totalDistance': { $gt: 0 } });
    const countWithLean = await db.collection('rides').countDocuments({ 'stats.maxLeanAngle': { $gt: 0 } });
    const usersWithKm = await db.collection('users').countDocuments({ totalKm: { $gt: 0 } });
    console.log({ countTotal, countWithDist, countWithLean, usersWithKm });
    process.exit(0);
}
main();
