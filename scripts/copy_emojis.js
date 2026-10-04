import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourceDir = 'C:\\Users\\ishak\\.gemini\\antigravity\\brain\\7a090c04-27e9-4a93-a379-ad41d058a594';
const destDir = path.join(__dirname, '../uploads');

const filesToCopy = [
    { src: 'moto_wave_neon_1771977246793.png', dest: 'moto_wave.png' },
    { src: 'moto_helmet_neon_1771977264072.png', dest: 'neon_helmet.png' },
    { src: 'moto_fire_exhaust_1771977283427.png', dest: 'moto_fire.png' },
    { src: 'moto_wheel_neon_1771978803838.png', dest: 'moto_wheel.png' },
    { src: 'moto_heart_neon_1771978843200.png', dest: 'moto_heart.png' },
    { src: 'moto_key_neon_1771978824738.png', dest: 'moto_key.png' },
    { src: 'moto_wave_neon_1771977246793.png', dest: 'speedometer.png' } // Fallback
];

let successCount = 0;

for (const fileConf of filesToCopy) {
    const srcPath = path.join(sourceDir, fileConf.src);
    const destPath = path.join(destDir, fileConf.dest);

    if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`✅ Kopyalandı: ${fileConf.dest}`);
        successCount++;
    } else {
        console.error(`❌ Bulunamadı: ${srcPath}`);
    }
}

if (successCount === filesToCopy.length) {
    console.log('🎉 Tüm emojiler sisteme başarıyla taşındı!');
} else {
    console.log(`⚠️ ${successCount}/${filesToCopy.length} emoji taşınabildi.`);
}
