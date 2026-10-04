import mongoose from 'mongoose';

const AchievementSchema = new mongoose.Schema({
  slug: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  category: {
    type: String,
    enum: ['Performans', 'Sosyal', 'Keşif'],
    required: true
  },
  badgeType: {
    type: String,
    enum: ['Gold', 'Neon', 'Carbon'],
    required: true
  },
  metric: {
    type: String,
    enum: ['points', 'totalKm', 'topSpeed', 'maxLeanAngle', 'nightRides', 'uniqueCities', 'packLeads', 'eventsCreated', 'followGraph', 'uniqueInteractions'],
    required: true
  },
  requiredValue: {
    type: Number,
    required: true
  },
  unit: {
    type: String,
    default: ''
  },
  pointsReward: {
    type: Number,
    default: 50
  }
}, {
  timestamps: true
});

const Achievement = mongoose.models.Achievement || mongoose.model('Achievement', AchievementSchema);
export default Achievement;
