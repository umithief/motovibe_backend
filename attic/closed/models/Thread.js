import mongoose from 'mongoose';

const threadSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 150
  },
  body: {
    type: String,
    required: true
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  linkedBike: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RideActivity', // Assuming Garage Bike might relate to Ride/RideActivity, or we use a string representation. Wait, there's no GarageBike schema. Let's make it generic or use ObjectId without strict ref. Let's just use ref: 'RideActivity' for now or omit ref to avoid strict validation if it's dynamic. Let's leave ref out for flexibility if Garage model doesn't exist. Actually, let's just make it ObjectId.
  },
  category: {
    type: String,
    enum: ['MEKANİK', 'EKİPMAN', 'ROTA', 'GENEL'],
    default: 'GENEL'
  },
  tags: [{
    type: String
  }],
  revScore: {
    type: Number,
    default: 0
  },
  isResolved: {
    type: Boolean,
    default: false
  },
  upvoters: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  downvoters: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
}, { timestamps: true });

export default mongoose.models.Thread || mongoose.model('Thread', threadSchema);
