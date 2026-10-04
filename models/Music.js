import mongoose from 'mongoose';

const musicSchema = new mongoose.Schema({
    title: String,
    artist: String,
    url: String,
    addedAt: String
}, { versionKey: false });

const Music = mongoose.models.Music || mongoose.model('Music', musicSchema);

export default Music;
