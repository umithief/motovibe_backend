import mongoose from 'mongoose';

const tagSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    postCount: {
      type: Number,
      default: 0,
      min: 0,
      index: -1,
    },
    followerCount: {
      type: Number,
      default: 0,
      min: 0,
      index: -1,
    },
    followerIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    lastUsedAt: {
      type: Date,
      default: Date.now,
      index: -1,
    },
  },
  { timestamps: true },
);

tagSchema.pre('validate', function ensureDisplayName() {
  if (!this.displayName && this.name) {
    this.displayName = `#${this.name}`;
  }
});

tagSchema.index({ followerCount: -1, postCount: -1, lastUsedAt: -1 });
tagSchema.index({ postCount: -1, lastUsedAt: -1 });

const Tag = mongoose.model('Tag', tagSchema);
export default Tag;
