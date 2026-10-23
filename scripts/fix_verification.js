import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import User from "../modules/users/model.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env from one level up (backend/.env)
dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) throw new Error('MONGO_URI ortam degiskeni zorunludur.');

const fixVerification = async () => {
    try {
        console.log('⏳ MongoDB bağlantısı kuruluyor...');
        await mongoose.connect(MONGO_URI);
        console.log('✅ MongoDB bağlantısı başarılı');

        console.log('⏳ Onaysız kullanıcıların mavi tikleri kaldırılıyor...');
        const resultRemoved = await User.updateMany(
            { verificationStatus: { $ne: 'approved' }, isVerified: true },
            { $set: { isVerified: false } }
        );
        console.log(`✅ ${resultRemoved.modifiedCount} kullanıcıdan hatalı mavi tik kaldırıldı.`);

        console.log('⏳ Onaylı kullanıcıların mavi tikleri doğrulanıyor...');
        const resultAdded = await User.updateMany(
            { verificationStatus: 'approved', isVerified: false },
            { $set: { isVerified: true } }
        );
        console.log(`✅ ${resultAdded.modifiedCount} onaylı kullanıcıya mavi tik geri eklendi.`);

        console.log('🏁 İşlem tamamlandı.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Hata oluştu:', error);
        process.exit(1);
    }
};

fixVerification();
