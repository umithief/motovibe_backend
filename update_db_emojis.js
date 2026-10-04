import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Emoji from './models/Emoji.js';

dotenv.config();

const BASE_URL = 'http://192.168.1.107:5001';

const customEmojis = [
  { code: ':moto_wave:', imageUrl: `${BASE_URL}/uploads/emojis/moto_wave.png`, category: 'REACTION', tags: ['wave', 'hand', 'greeting'], isPremium: false, sortOrder: 1 },
  { code: ':exhaust_fire:', imageUrl: `${BASE_URL}/uploads/emojis/exhaust_fire.png`, category: 'REACTION', tags: ['fire', 'exhaust', 'flame', 'rev'], isPremium: false, sortOrder: 2 },
  { code: ':superbike:', imageUrl: `${BASE_URL}/uploads/emojis/superbike.png`, category: 'BIKES', tags: ['fast', 'sportbike', 'purple', 'race'], isPremium: true, sortOrder: 3 },
  { code: ':helmet_glow:', imageUrl: `${BASE_URL}/uploads/emojis/helmet_glow.png`, category: 'GEAR', tags: ['helmet', 'glow', 'gold', 'protection'], isPremium: true, sortOrder: 4 },
  { code: ':rpm_gauge:', imageUrl: `${BASE_URL}/uploads/emojis/exhaust_fire.png`, category: 'TECH', tags: ['speed', 'rpm', 'gauge'], isPremium: true, sortOrder: 5 }, // imageUrl doesn't matter for vector emojis
  { code: ':nitro_boost:', imageUrl: `${BASE_URL}/uploads/emojis/exhaust_fire.png`, category: 'TECH', tags: ['nitro', 'nos', 'boost'], isPremium: true, sortOrder: 6 },
  { code: ':moto_love:', imageUrl: `${BASE_URL}/uploads/emojis/exhaust_fire.png`, category: 'REACTION', tags: ['heart', 'love', 'like'], isPremium: false, sortOrder: 7 },
  { code: ':star_rider:', imageUrl: `${BASE_URL}/uploads/emojis/exhaust_fire.png`, category: 'REACTION', tags: ['star', 'best', 'rider'], isPremium: true, sortOrder: 8 },
  { code: ':danger_zone:', imageUrl: `${BASE_URL}/uploads/emojis/exhaust_fire.png`, category: 'REACTION', tags: ['danger', 'alert', 'warning'], isPremium: false, sortOrder: 9 },
  { code: ':music_vibe:', imageUrl: `${BASE_URL}/uploads/emojis/exhaust_fire.png`, category: 'REACTION', tags: ['music', 'song', 'listen'], isPremium: false, sortOrder: 10 },
  { code: ':group_ride:', imageUrl: `${BASE_URL}/uploads/emojis/exhaust_fire.png`, category: 'BIKES', tags: ['group', 'friends', 'together'], isPremium: false, sortOrder: 11 },
  { code: ':cool_glasses:', imageUrl: `${BASE_URL}/uploads/emojis/exhaust_fire.png`, category: 'REACTION', tags: ['cool', 'glasses', 'vibe'], isPremium: false, sortOrder: 13 },
  { code: ':route_map:', imageUrl: `${BASE_URL}/uploads/emojis/exhaust_fire.png`, category: 'GEAR', tags: ['map', 'route', 'travel'], isPremium: false, sortOrder: 14 },
  { code: ':compass_nav:', imageUrl: `${BASE_URL}/uploads/emojis/exhaust_fire.png`, category: 'GEAR', tags: ['compass', 'navigation'], isPremium: false, sortOrder: 15 },
  { code: ':sun_ride:', imageUrl: `${BASE_URL}/uploads/emojis/exhaust_fire.png`, category: 'REACTION', tags: ['sun', 'day', 'ride'], isPremium: false, sortOrder: 16 },
  { code: ':night_rider:', imageUrl: `${BASE_URL}/uploads/emojis/exhaust_fire.png`, category: 'REACTION', tags: ['moon', 'night', 'dark'], isPremium: true, sortOrder: 17 },
  { code: ':wind_blast:', imageUrl: `${BASE_URL}/uploads/emojis/exhaust_fire.png`, category: 'REACTION', tags: ['wind', 'fast', 'aero'], isPremium: false, sortOrder: 18 },
  { code: ':battery_full:', imageUrl: `${BASE_URL}/uploads/emojis/exhaust_fire.png`, category: 'TECH', tags: ['battery', 'power', 'full'], isPremium: true, sortOrder: 19 },
  { code: ':phone_mount:', imageUrl: `${BASE_URL}/uploads/emojis/exhaust_fire.png`, category: 'TECH', tags: ['phone', 'mount', 'device'], isPremium: false, sortOrder: 20 },
  { code: ':helmet_cam:', imageUrl: `${BASE_URL}/uploads/emojis/exhaust_fire.png`, category: 'GEAR', tags: ['camera', 'photo', 'shot'], isPremium: true, sortOrder: 21 },
  { code: ':video_log:', imageUrl: `${BASE_URL}/uploads/emojis/exhaust_fire.png`, category: 'GEAR', tags: ['video', 'vlog', 'record'], isPremium: true, sortOrder: 22 },
  { code: ':track_race:', imageUrl: `${BASE_URL}/uploads/emojis/exhaust_fire.png`, category: 'BIKES', tags: ['race', 'flag', 'track'], isPremium: true, sortOrder: 23 },
  { code: ':coffee_stop:', imageUrl: `${BASE_URL}/uploads/emojis/exhaust_fire.png`, category: 'REACTION', tags: ['coffee', 'stop', 'break'], isPremium: false, sortOrder: 24 },
  { code: ':power_on:', imageUrl: `${BASE_URL}/uploads/emojis/exhaust_fire.png`, category: 'TECH', tags: ['power', 'on', 'start'], isPremium: false, sortOrder: 25 },
  { code: ':radio_comms:', imageUrl: `${BASE_URL}/uploads/emojis/exhaust_fire.png`, category: 'TECH', tags: ['radio', 'intercom', 'talk'], isPremium: true, sortOrder: 26 },
  { code: ':lock_secure:', imageUrl: `${BASE_URL}/uploads/emojis/exhaust_fire.png`, category: 'GEAR', tags: ['lock', 'security', 'safe'], isPremium: false, sortOrder: 27 },
  { code: ':key_ignition:', imageUrl: `${BASE_URL}/uploads/emojis/exhaust_fire.png`, category: 'GEAR', tags: ['key', 'ignition', 'start'], isPremium: true, sortOrder: 28 }
];

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('✅ Veritabanına bağlanıldı.');
    await Emoji.deleteMany({});
    console.log('🧹 Eski emojiler temizlendi.');
    await Emoji.insertMany(customEmojis);
    console.log('✨ YENİ ve TEMİZ MotoMoji seti başarıyla eklendi!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Hata:', err);
    process.exit(1);
  });
