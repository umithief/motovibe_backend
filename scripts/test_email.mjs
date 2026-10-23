import dotenv from 'dotenv';
dotenv.config();
import { sendPasswordResetEmail } from "../modules/notifications/email.service.js";

const targetEmail = process.argv[2] || process.env.SMTP_USER;
console.log(`[Test] Test e-postası gönderiliyor -> ${targetEmail}`);

async function run() {
    try {
        const result = await sendPasswordResetEmail(targetEmail, '987654', 'Değerli Sürücü');
        console.log('[Test] Sonuç:', result);
        process.exit(0);
    } catch (err) {
        console.error('[Test] Hata:', err);
        process.exit(1);
    }
}
run();
