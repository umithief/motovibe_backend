import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Emoji from './models/Emoji.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) throw new Error('MONGO_URI ortam degiskeni zorunludur.');

const emojis = [
  // REACTION
  {
    code: ':moto_wave:',
    imageUrl: 'https://placehold.co/100x100/101015/E2FF3B/png?text=WAVE',
    category: 'REACTION',
    tags: ['wave', 'hand', 'greeting'],
    sortOrder: 1
  },
  {
    code: ':exhaust_fire:',
    imageUrl: 'https://placehold.co/100x100/101015/FF4500/png?text=FIRE', 
    category: 'REACTION',
    tags: ['fire', 'exhaust', 'flame', 'lit'],
    sortOrder: 2
  },
  {
    code: ':respect:',
    imageUrl: 'https://placehold.co/100x100/101015/E2FF3B/png?text=FIST',
    category: 'REACTION',
    tags: ['fist', 'respect', 'bump'],
    sortOrder: 3
  },
  
  // GEAR
  {
    code: ':neon_helmet:',
    imageUrl: 'https://placehold.co/100x100/101015/00FFFF/png?text=HLMT',
    category: 'GEAR',
    tags: ['helmet', 'head', 'safety'],
    sortOrder: 4
  },
  {
    code: ':adv_helmet:',
    imageUrl: 'https://placehold.co/100x100/101015/E2FF3B/png?text=ADV',
    category: 'GEAR',
    tags: ['helmet', 'adventure', 'offroad'],
    sortOrder: 5
  },
  {
    code: ':armored_jacket:',
    imageUrl: 'https://placehold.co/100x100/101015/E2FF3B/png?text=JKT',
    category: 'GEAR',
    tags: ['jacket', 'armor', 'leather'],
    sortOrder: 6
  },
  {
    code: ':moto_gloves:',
    imageUrl: 'https://placehold.co/100x100/101015/E2FF3B/png?text=GLOV',
    category: 'GEAR',
    tags: ['gloves', 'hands', 'gear'],
    sortOrder: 7
  },

  // BIKES
  {
    code: ':piston_power:',
    imageUrl: 'https://placehold.co/100x100/101015/E2FF3B/png?text=PSTN',
    category: 'BIKES',
    tags: ['piston', 'engine', 'power'],
    sortOrder: 8
  },
  {
    code: ':wrench_fix:',
    imageUrl: 'https://placehold.co/100x100/101015/00FFFF/png?text=FIX',
    category: 'BIKES',
    tags: ['wrench', 'fix', 'mechanic'],
    sortOrder: 9
  },
  {
    code: ':speed_dial:',
    imageUrl: 'https://placehold.co/100x100/101015/FF0055/png?text=SPED',
    category: 'BIKES',
    tags: ['speed', 'dial', 'fast'],
    sortOrder: 10
  },
  {
    code: ':on_road:',
    imageUrl: 'https://placehold.co/100x100/101015/E2FF3B/png?text=ROAD',
    category: 'BIKES',
    tags: ['road', 'riding', 'status'],
    sortOrder: 11
  },
  {
    code: ':in_garage:',
    imageUrl: 'https://placehold.co/100x100/101015/00FFFF/png?text=PARK',
    category: 'BIKES',
    tags: ['garage', 'parked', 'status'],
    sortOrder: 12
  }
];

const seedEmojis = async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('✅ MongoDB Connected for Emojis');

        console.log('🧹 Clearing existing emojis...');
        await Emoji.deleteMany({});

        console.log('🌱 Seeding MotoMojis...');
        await Emoji.insertMany(emojis);
        
        console.log('✅ MotoMojis seeded successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Seeding failed:', error);
        process.exit(1);
    }
};

seedEmojis();
