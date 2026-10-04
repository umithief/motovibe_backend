import nodemailer from 'nodemailer';

let transporter = null;

function getTransporter() {
    if (transporter) return transporter;

    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (host && user && pass) {
        transporter = nodemailer.createTransport({
            host,
            port,
            secure: port === 465,
            auth: { user, pass },
            tls: {
                rejectUnauthorized: true
            }
        });
        console.log('[EmailService] ✅ SMTP Transporter yapılandırıldı:', host);
    }

    return transporter;
}

/**
 * Sends a password reset OTP email
 * @param {string} toEmail 
 * @param {string} otpCode 
 * @param {string} userName 
 */
export async function sendPasswordResetEmail(toEmail, otpCode, userName = 'Sürücü') {
    const fromAddress = process.env.FROM_EMAIL || '"Motonom Destek" <iletisim@motonom.app>';
    const isProd = process.env.NODE_ENV === 'production';

    const mailOptions = {
        from: fromAddress,
        to: toEmail,
        subject: `🔑 Motonom Şifre Sıfırlama Kodu: ${otpCode}`,
        text: `Merhaba ${userName},\n\nŞifre sıfırlama doğrulama kodunuz: ${otpCode}\n\nBu kod 15 dakika boyunca geçerlidir. Eğer bu talebi siz yapmadıysanız bu mesajı görmezden gelebilirsiniz.\n\nİyi sürüşler,\nMotonom Ekibi`,
        html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0A0A0C; color: #FFFFFF; margin: 0; padding: 24px; }
            .container { max-width: 520px; margin: 0 auto; background: #121316; border: 1px solid #24262E; border-radius: 16px; padding: 32px; }
            .header { text-align: center; margin-bottom: 24px; }
            .brand { font-size: 24px; font-weight: 800; letter-spacing: 2px; color: #E2FF3B; text-transform: uppercase; }
            .title { font-size: 18px; font-weight: 700; color: #FFFFFF; margin-top: 12px; }
            .otp-box { background: #1B1D22; border: 1px dashed #E2FF3B; border-radius: 12px; padding: 20px; text-align: center; margin: 28px 0; }
            .otp-code { font-family: 'Courier New', monospace; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #E2FF3B; }
            .expire-note { font-size: 12px; color: #8E929C; margin-top: 8px; }
            .info-text { font-size: 14px; line-height: 1.6; color: #D1D5DB; }
            .footer { margin-top: 32px; border-top: 1px solid #24262E; padding-top: 16px; font-size: 11px; color: #6B7280; text-align: center; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="brand">MOTONOM</div>
              <div class="title">Şifre Sıfırlama Doğrulama Kodu</div>
            </div>
            <p class="info-text">Merhaba <strong>${userName}</strong>,</p>
            <p class="info-text">Motonom hesabınızın şifresini sıfırlamak için bir talep aldık. Aşağıdaki 6 haneli doğrulama kodunu uygulamadaki ekrana giriniz:</p>
            <div class="otp-box">
              <div class="otp-code">${otpCode}</div>
              <div class="expire-note">Bu kod 15 dakika boyunca geçerlidir.</div>
            </div>
            <p class="info-text" style="font-size: 12px; color: #9CA3AF;">Eğer bu şifre sıfırlama talebini siz gerçekleştirmediyseniz, hesabınız güvendedir. Bu e-postayı dikkate almayabilirsiniz.</p>
            <div class="footer">
              © ${new Date().getFullYear()} Motonom. Tüm hakları saklıdır. Virajın ritmini yakala.
            </div>
          </div>
        </body>
        </html>
        `
    };

    const mailer = getTransporter();

    if (mailer) {
        try {
            const info = await mailer.sendMail(mailOptions);
            console.log(`[EmailService] ✉️ Şifre sıfırlama e-postası başarıyla gönderildi: ${toEmail} (ID: ${info.messageId})`);
            return { success: true, messageId: info.messageId };
        } catch (mailErr) {
            console.error('[EmailService] ❌ E-posta gönderim hatası:', mailErr.message);
            if (!isProd) {
                console.log(`[EmailService Dev Fallback] OTP Kodu: ${otpCode}`);
            }
            return { success: false, error: mailErr.message };
        }
    } else {
        if (!isProd) {
            console.log(`\n======================================================`);
            console.log(`🔑 [DEV MODE OTP - SMTP Yapılandırılmadı]`);
            console.log(`📧 Alıcı: ${toEmail}`);
            console.log(`🔢 OTP Kodu: ${otpCode} (15 dakika geçerli)`);
            console.log(`======================================================\n`);
        } else {
            console.warn('[EmailService] ⚠️ SMTP_HOST/USER/PASS env tanımlanmadığı için e-posta gönderilemedi.');
        }
        return { success: true, isDevMock: !isProd };
    }
}
