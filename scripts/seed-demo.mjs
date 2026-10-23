import GroupRide from '../modules/rides/GroupRide.model.js';
import User from '../modules/users/model.js';
import { SEED_GROUP_RIDES } from './group-ride-demo-data.mjs';
import 'dotenv/config';
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { getMongoUri } from '../config/env.js';
import Route from "../modules/routes/model.js";
import MeetupEvent from "../modules/events/model.js";
import Emoji from "../modules/emojis/model.js";
import { ensureDefaultAchievements } from "../modules/achievements/service.js";
export const seedDatabase = async ({organizerId}={}) => {
    try {
        if(organizerId){
            const organizer=await User.findById(organizerId).select('_id name username avatar');
            if(!organizer)throw new Error('Demo organizer must be an existing development user.');
            if(await GroupRide.countDocuments()===0){
                const demos=SEED_GROUP_RIDES.map((ride,index)=>({...ride,
                    date:new Date(Date.now()+(index+1)*86400000).toISOString().slice(0,10),
                    organizer:{userId:organizer._id,name:organizer.name || organizer.username,avatar:organizer.avatar || ''}}));
                await GroupRide.insertMany(demos);
            }
        }
        const routeCount = await Route.countDocuments();
        if (routeCount === 0) {
            console.log('📦 Rotalar veritabanına ekleniyor...');
            await Route.insertMany([
                {
                    title: 'Trans Toros Geçişi',
                    description: 'Akdeniz\'in zirvelerinde virajlı ve manzaralı bir sürüş.',
                    image: `uploads/vibemesh_ultra.png`, // Use local image for offline support
                    difficulty: 'Zor',
                    distance: '320 km',
                    estimatedTime: '6 Saat',
                    location: 'Antalya',
                    bestSeason: 'İlkbahar',
                    tags: ['Dağ', 'Viraj'],
                    path: {
                        type: 'LineString',
                        coordinates: [
                            [30.7056, 36.8841], // lng, lat
                            [30.8000, 37.0000],
                            [31.0000, 37.1500],
                            [31.2000, 37.3000],
                            [31.4000, 37.5000]
                        ]
                    },
                    coordinates: [
                        { lat: 36.8841, lng: 30.7056 },
                        { lat: 37.0000, lng: 30.8000 },
                        { lat: 37.1500, lng: 31.0000 },
                        { lat: 37.3000, lng: 31.2000 },
                        { lat: 37.5000, lng: 31.4000 }
                    ]
                }
            ]);
        }

        // FIX: Rotalar yerel resimlere ayarlandı.
        // Gerekli değilse artık her seferinde loop yapıp tüm sunucuyu bekletmiyoruz.




        // Social seeding removed

        const eventCount = await MeetupEvent.countDocuments();
        if (eventCount === 0) {
            console.log('📦 Etkinlikler veritabanına ekleniyor...');
            await MeetupEvent.insertMany([
                {
                    title: 'Gece Sürüşü: İstanbul Işıkları',
                    type: 'night-ride',
                    date: '2025-06-15',
                    time: '22:00',
                    location: 'Bağdat Caddesi, İstanbul',
                    coordinates: { lat: 40.9632, lng: 29.0632 },
                    organizer: 'MotoVibe Team',
                    attendees: 42,
                    image: 'https://images.unsplash.com/photo-1558981403-c5f91cbba527?q=80&w=800&auto=format&fit=crop',
                    description: 'İstanbul\'un eşsiz gece manzarasında yaklaşık 2 saatlik keyifli bir sürüş.'
                },
                {
                    title: 'Pazar Kahvesi & Sohbet',
                    type: 'coffee',
                    date: '2025-06-18',
                    time: '10:00',
                    location: 'Emirgan Korusu',
                    coordinates: { lat: 41.1082, lng: 29.0553 },
                    organizer: 'Cafe Racers TR',
                    attendees: 15,
                    image: 'https://images.unsplash.com/photo-1512413914633-b5043f4041ea?q=80&w=800&auto=format&fit=crop',
                    description: 'Hafta sonuna güzel bir kahve ve motosiklet sohbetiyle başlıyoruz.'
                }
            ]);
        }



        const emojiCount = await Emoji.countDocuments();
        if (emojiCount < 7) {
            console.log('📦 Yeni Custom Emojiler veritabanına ekleniyor (MotoMojis V2)...');
            const newEmojis = [
                { code: ':moto_wave:', imageUrl: `uploads/moto_wave.png`, category: 'REACTION', tags: ['selam', 'wave', 'biker'], isPremium: false, sortOrder: 1 },
                { code: ':moto_fire:', imageUrl: `uploads/moto_fire.png`, category: 'REACTION', tags: ['ateş', 'fire', 'lit'], isPremium: false, sortOrder: 2 },
                { code: ':moto_heart:', imageUrl: `uploads/moto_heart.png`, category: 'REACTION', tags: ['kalp', 'heart', 'love', 'piston'], isPremium: false, sortOrder: 3 },
                { code: ':neon_helmet:', imageUrl: `uploads/neon_helmet.png`, category: 'GEAR', tags: ['kask', 'helmet', 'neon'], isPremium: false, sortOrder: 1 },
                { code: ':moto_wheel:', imageUrl: `uploads/moto_wheel.png`, category: 'GEAR', tags: ['teker', 'wheel', 'rim', 'tire'], isPremium: false, sortOrder: 2 },
                { code: ':speedometer:', imageUrl: `uploads/speedometer.png`, category: 'TECH', tags: ['hız', 'speed', 'tacho'], isPremium: false, sortOrder: 1 },
                { code: ':moto_key:', imageUrl: `uploads/moto_key.png`, category: 'TECH', tags: ['anahtar', 'key', 'fob'], isPremium: false, sortOrder: 2 },
            ];

            for (let emoji of newEmojis) {
                await Emoji.findOneAndUpdate(
                    { code: emoji.code },
                    { $set: emoji },
                    { upsert: true, returnDocument: 'after' }
                );
            }
        }

    } catch (error) {
        throw error;
    }
};


if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    if (process.env.NODE_ENV === 'production') throw new Error('Demo seed is disabled in production.');
    if (!process.argv.includes('--apply')) throw new Error('Use --apply to seed a development database.');
    try { await mongoose.connect(getMongoUri()); await seedDatabase({organizerId:process.argv.find(arg=>arg.startsWith('--organizer='))?.slice(12)}); await ensureDefaultAchievements(); }
    finally { await mongoose.disconnect(); }
}
