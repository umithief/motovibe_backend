import mongoose from 'mongoose';
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) throw new Error('MONGO_URI ortam degiskeni zorunludur.');
mongoose.connect(MONGO_URI).then(async () => {
  const db = mongoose.connection.db;
  const posts = await db.collection('socialposts').find({ 'media.0': { $exists: true } }).limit(5).toArray();
  console.log('Posts media:');
  posts.forEach(p => console.log(JSON.stringify(p.media)));
  process.exit(0);
});
