import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    const db = mongoose.connection.db;
    const rides = await db.collection('rides')
        .find({ 'stats.totalDistance': { $gt: 0 } })
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray();
    console.log('Recent rides with distance:');
    rides.forEach(r => console.log(r.title, 'dist:', r.stats?.totalDistance, 'lean:', r.stats?.maxLeanAngle, 'createdAt:', r.createdAt || r.date));
    process.exit(0);
}
main();
