import mongoose from 'mongoose';
import Post from './models/Post.js';
import Reel from './models/Reel.js';
import User from './models/User.js';

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) throw new Error('MONGO_URI ortam degiskeni zorunludur.');

async function fixUrls() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB");

  // Helper to make path relative
  const makeRelative = (url) => {
    if (!url) return url;
    if (url.includes("uploads/")) {
      const parts = url.split("uploads/");
      return "uploads/" + parts[parts.length - 1];
    }
    return url;
  };

  // Fix Posts
  const posts = await Post.find({});
  let postCount = 0;
  for (const post of posts) {
    let changed = false;
    
    if (post.mediaUrl) {
      const newVal = makeRelative(post.mediaUrl);
      if (newVal !== post.mediaUrl) {
        post.mediaUrl = newVal;
        changed = true;
      }
    }
    
    if (post.media && post.media.length > 0) {
      for (let i = 0; i < post.media.length; i++) {
        if (post.media[i].url) {
          const newVal = makeRelative(post.media[i].url);
          if (newVal !== post.media[i].url) {
            post.media[i].url = newVal;
            changed = true;
          }
        }
      }
    }
    
    if (post.images && post.images.length > 0) {
      for (let i = 0; i < post.images.length; i++) {
        if (post.images[i]) {
          const newVal = makeRelative(post.images[i]);
          if (newVal !== post.images[i]) {
            post.images[i] = newVal;
            changed = true;
          }
        }
      }
    }
    
    if (changed) {
      await post.save();
      postCount++;
    }
  }

  // Fix Reels
  const reels = await Reel.find({});
  let reelCount = 0;
  for (const reel of reels) {
    let changed = false;
    
    if (reel.videoUrl) {
      const newVal = makeRelative(reel.videoUrl);
      if (newVal !== reel.videoUrl) {
        reel.videoUrl = newVal;
        changed = true;
      }
    }
    
    if (reel.thumbnailUrl) {
      const newVal = makeRelative(reel.thumbnailUrl);
      if (newVal !== reel.thumbnailUrl) {
        reel.thumbnailUrl = newVal;
        changed = true;
      }
    }
    
    if (changed) {
      await reel.save();
      reelCount++;
    }
  }

  // Fix Users (Avatars / Cover Images)
  const users = await User.find({});
  let userCount = 0;
  for (const user of users) {
    let changed = false;
    
    if (user.avatar) {
      const newVal = makeRelative(user.avatar);
      if (newVal !== user.avatar) {
        user.avatar = newVal;
        changed = true;
      }
    }
    
    if (user.headerImage) {
      const newVal = makeRelative(user.headerImage);
      if (newVal !== user.headerImage) {
        user.headerImage = newVal;
        changed = true;
      }
    }
    
    if (changed) {
      await user.save();
      userCount++;
    }
  }

  console.log(`Updated ${postCount} posts, ${reelCount} reels, and ${userCount} users to relative URLs.`);
  process.exit(0);
}

fixUrls().catch(console.error);
