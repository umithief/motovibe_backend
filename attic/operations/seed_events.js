
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import MeetupEvent from './models/MeetupEvent.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) throw new Error('MONGO_URI ortam degiskeni zorunludur.');

const seedEvents = async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('✅ MongoDB Connected');

        console.log('🧹 Clearing existing events...');
        await MeetupEvent.deleteMany({});

        console.log('🌱 Seeding events...');

        const events = [
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
            },
            {
                title: 'Pist Günü: İstanbul Park',
                type: 'track-day',
                date: '2025-07-01',
                time: '09:00',
                location: 'İstanbul Park',
                coordinates: { lat: 40.9576, lng: 29.4109 },
                organizer: 'Track Days TR',
                attendees: 120,
                image: 'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?q=80&w=800&auto=format&fit=crop',
                description: 'Adrenalin dolu bir gün için pistte buluşuyoruz. Tüm güvenlik ekipmanları zorunludur.'
            }
        ];

        await MeetupEvent.insertMany(events);
        console.log('✅ Events seeded successfully!');

        process.exit(0);
    } catch (error) {
        console.error('❌ Seeding failed:', error);
        process.exit(1);
    }
};

seedEvents();
