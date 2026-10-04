import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Route from '../models/Route.js';
import path from 'path';
import { fileURLToPath } from 'url';

// Fix __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env vars
dotenv.config({ path: path.join(__dirname, '../../.env') });

const seedRoutes = async () => {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected.');

        console.log('🗑️ Clearing existing routes...');
        await Route.deleteMany({});

        console.log('🌱 Seeding 10 premium routes...');
        const sampleRoutes = [
            // 1. Coastal (Existing)
            {
                title: 'Şile Sahil Yolu',
                description: 'Mavi ve yeşilin buluştuğu bu sahil yolunda rüzgarla dans edin. Keskin virajlar ve uzun düzlüklerin mükemmel dengesi.',
                distance: '145 km',
                estimatedTime: '2h 15m',
                difficulty: 'Orta',
                location: 'Şile, İstanbul',
                image: '/assets/routes/coastal.png',
                stats: { curves: 75, roadQuality: 90, traffic: 40 },
                tags: ['Sahil', 'Manzara', 'Hızlı', 'Virajlı'],
                riderCount: 1243,
                bestSeason: 'İlkbahar, Yaz',
                difficultyMetrics: { technical: 3, scenery: 5, speed: 4 },
                terrain: ['Asfalt'],
                coordinates: [{ lat: 41.1744, lng: 29.6116 }, { lat: 41.1780, lng: 29.6200 }]
            },
            // 2. Mountain (Existing)
            {
                title: 'Uludağ Zirve Tırmanışı',
                description: 'Bulutların üzerine çıkmaya hazır mısın? Keskin hairpin virajları ve serin dağ havasıyla gerçek bir sürüş testi.',
                distance: '42 km',
                estimatedTime: '1h 10m',
                difficulty: 'Zor',
                location: 'Bursa',
                image: '/assets/routes/mountain.png',
                stats: { curves: 95, roadQuality: 85, traffic: 30 },
                tags: ['Dağ', 'Teknik', 'Viraj', 'Soğuk'],
                riderCount: 856,
                bestSeason: 'Yaz, Sonbahar',
                difficultyMetrics: { technical: 5, scenery: 5, speed: 2 },
                terrain: ['Asfalt'],
                coordinates: [{ lat: 40.1828, lng: 29.0669 }, { lat: 40.1500, lng: 29.0800 }]
            },
            // 3. Forest (Existing)
            {
                title: 'Belgrad Ormanı Keşfi',
                description: 'Şehrin gürültüsünden kaçıp doğanın kalbine yolculuk. Ağaç tünelleri arasından geçen bu rota, huzurlu ve keyifli bir sürüş vadediyor.',
                distance: '25 km',
                estimatedTime: '45m',
                difficulty: 'Kolay',
                location: 'Sarıyer, İstanbul',
                image: '/assets/routes/forest.png',
                stats: { curves: 40, roadQuality: 70, traffic: 50 },
                tags: ['Orman', 'Doğa', 'Kısa Rota', 'Huzur'],
                riderCount: 2105,
                bestSeason: 'Sonbahar, İlkbahar',
                difficultyMetrics: { technical: 2, scenery: 4, speed: 3 },
                terrain: ['Asfalt', 'Stabilize'],
                coordinates: [{ lat: 41.1790, lng: 28.9800 }, { lat: 41.1900, lng: 28.9900 }]
            },
            // 4. City Night (Existing)
            {
                title: 'İstanbul Gece Hattı',
                description: 'Şehir uyurken asfalt senin. Köprü ışıkları, boş caddeler ve neon tabelalar eşliğinde siberpunk bir sürüş deneyimi.',
                distance: '60 km',
                estimatedTime: '1h 30m',
                difficulty: 'Orta',
                location: 'İstanbul',
                image: '/assets/routes/city.png',
                stats: { curves: 30, roadQuality: 95, traffic: 20 },
                tags: ['Gece', 'Şehir', 'Fotoğraf', 'Cruise'],
                riderCount: 3420,
                bestSeason: 'Her Mevsim (Gece)',
                difficultyMetrics: { technical: 2, scenery: 5, speed: 4 },
                terrain: ['Asfalt'],
                coordinates: [{ lat: 41.0082, lng: 28.9784 }, { lat: 41.0400, lng: 29.0100 }]
            },
            // 5. Canyon (New)
            {
                title: 'Saklıkent Kanyon Yolu',
                description: 'Derin vadilerin arasından kıvrılarak geçen, kırmızı kayaların çevrelediği epik bir sürüş. Ses yankısı ve manzarasıyla büyüleyici.',
                distance: '85 km',
                estimatedTime: '1h 45m',
                difficulty: 'Zor',
                location: 'Muğla/Antalya',
                image: '/assets/routes/canyon.png',
                stats: { curves: 80, roadQuality: 75, traffic: 10 },
                tags: ['Kanyon', 'Macera', 'Viraj', 'Sıcak'],
                riderCount: 650,
                bestSeason: 'İlkbahar, Sonbahar',
                difficultyMetrics: { technical: 4, scenery: 5, speed: 3 },
                terrain: ['Asfalt'],
                coordinates: [{ lat: 36.6417, lng: 29.4000 }, { lat: 36.6800, lng: 29.4500 }]
            },
            // 6. Lake (New)
            {
                title: 'Abant Gölü Turu',
                description: 'Göl kenarında sakin ve huzurlu bir sürüş. Yemyeşil doğa ve masmavi suyun eşlik ettiği, fotoğraf molalarıyla dolu bir rota.',
                distance: '18 km',
                estimatedTime: '40m',
                difficulty: 'Kolay',
                location: 'Bolu',
                image: '/assets/routes/lake.png',
                stats: { curves: 50, roadQuality: 80, traffic: 60 },
                tags: ['Göl', 'Doğa', 'Kamp', 'Haftasonu'],
                riderCount: 4200,
                bestSeason: 'Dört Mevsim',
                difficultyMetrics: { technical: 1, scenery: 5, speed: 2 },
                terrain: ['Asfalt', 'Arnavut Kaldırımı'],
                coordinates: [{ lat: 40.6050, lng: 31.2750 }, { lat: 40.6150, lng: 31.2900 }]
            },
            // 7. Desert Straight (New)
            {
                title: 'Tuz Gölü Hız Denemesi',
                description: 'Ufuk çizgisine kadar uzanan dümdüz bir yol. Motosikletinin sınırlarını zorlamak ve sonsuzluk hissini tatmak için ideal.',
                distance: '120 km',
                estimatedTime: '1h',
                difficulty: 'Orta',
                location: 'Konya',
                image: '/assets/routes/desert.png',
                stats: { curves: 5, roadQuality: 98, traffic: 15 },
                tags: ['Hız', 'Düzlük', 'Gün Batımı', 'Fotoğraf'],
                riderCount: 1890,
                bestSeason: 'Yaz, Sonbahar',
                difficultyMetrics: { technical: 1, scenery: 4, speed: 5 },
                terrain: ['Asfalt'],
                coordinates: [{ lat: 38.8700, lng: 33.7000 }, { lat: 39.1000, lng: 33.5000 }]
            },
            // 8. Snowy Pass (New)
            {
                title: 'Zigana Geçidi',
                description: 'Karla kaplı zirvelerin arasından süzülün. Sisli, soğuk ve zorlu hava koşullarıyla gerçek bir meydan okuma.',
                distance: '55 km',
                estimatedTime: '1h 30m',
                difficulty: 'Çok Zor',
                location: 'Trabzon/Gümüşhane',
                image: '/assets/routes/snow.png',
                stats: { curves: 90, roadQuality: 60, traffic: 30 },
                tags: ['Kar', 'Tehlikeli', 'Dağ', 'Efsane'],
                riderCount: 340,
                bestSeason: 'Yaz (Kışın Kapalı)',
                difficultyMetrics: { technical: 5, scenery: 5, speed: 1 },
                terrain: ['Asfalt', 'Buzlu'],
                coordinates: [{ lat: 40.6500, lng: 39.4000 }, { lat: 40.6000, lng: 39.4200 }]
            },
            // 9. Sunset Highway (New)
            {
                title: 'İzmir Çeşme Otobanı',
                description: 'Ege rüzgarını arkanıza alın. Geniş şeritler, mükemmel asfalt ve gün batımına doğru yapılan keyifli bir sürüş.',
                distance: '80 km',
                estimatedTime: '45m',
                difficulty: 'Kolay',
                location: 'İzmir',
                image: '/assets/routes/sunset.png',
                stats: { curves: 20, roadQuality: 100, traffic: 50 },
                tags: ['Otoban', 'Hız', 'Deniz', 'Tatil'],
                riderCount: 8500,
                bestSeason: 'Yaz',
                difficultyMetrics: { technical: 1, scenery: 3, speed: 5 },
                terrain: ['Asfalt'],
                coordinates: [{ lat: 38.4237, lng: 27.1428 }, { lat: 38.3183, lng: 26.3033 }]
            },
            // 10. Bridge (New)
            {
                title: 'Köprüler Geçişi',
                description: 'İki kıtayı birbirine bağlayan devasa bir mühendislik harikası üzerinde sürüş. Denizin metrelerce üzerinde özgürlük hissi.',
                distance: '15 km',
                estimatedTime: '20m',
                difficulty: 'Orta',
                location: 'İstanbul',
                image: '/assets/routes/bridge.png',
                stats: { curves: 10, roadQuality: 95, traffic: 90 },
                tags: ['Köprü', 'Şehir', 'Manzara', 'Turistik'],
                riderCount: 15000,
                bestSeason: 'Her Mevsim',
                difficultyMetrics: { technical: 2, scenery: 5, speed: 3 },
                terrain: ['Asfalt'],
                coordinates: [{ lat: 41.0450, lng: 29.0300 }, { lat: 41.0470, lng: 29.0350 }]
            }
        ];

        await Route.insertMany(sampleRoutes);
        console.log('✨ 10 Routes seeded successfully!');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error seeding routes:', error);
        process.exit(1);
    }
};

seedRoutes();
