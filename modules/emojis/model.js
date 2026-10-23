import mongoose from 'mongoose';

const emojiSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, index: true }, // Örn: :moto_wave:
  imageUrl: { type: String, required: true },
  category: { type: String, enum: ['REACTION', 'GEAR', 'BIKES', 'TECH'], required: true },
  tags: [{ type: String, index: true }],
  isPremium: { type: Boolean, default: false },
  sortOrder: { type: Number, default: 0 }
}, { timestamps: true });

const Emoji = mongoose.model('Emoji', emojiSchema);
export default Emoji;
