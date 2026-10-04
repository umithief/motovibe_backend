/**
 * SMS & Emergency Communication Service
 * Supports Twilio, Netgsm, and custom Webhooks with graceful fallbacks.
 */

export async function sendSMS({ to, message }) {
    const isProd = process.env.NODE_ENV === 'production';
    const cleanedPhone = (to || '').replace(/[^\d+]/g, '');

    // 1. Twilio SMS
    const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioFromNumber = process.env.TWILIO_PHONE_NUMBER;

    if (twilioAccountSid && twilioAuthToken && twilioFromNumber) {
        try {
            const params = new URLSearchParams({
                To: cleanedPhone,
                From: twilioFromNumber,
                Body: message
            });

            const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`, {
                method: 'POST',
                headers: {
                    'Authorization': 'Basic ' + Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64'),
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: params.toString()
            });

            const data = await response.json();
            if (response.ok) {
                console.log(`[SMSService] 📱 SMS başarıyla iletildi (${cleanedPhone}), SID: ${data.sid}`);
                return { success: true, provider: 'TWILIO', sid: data.sid };
            } else {
                console.error('[SMSService] Twilio API Hatası:', data);
                return { success: false, provider: 'TWILIO', error: data.message };
            }
        } catch (err) {
            console.error('[SMSService] Twilio Bağlantı Hatası:', err.message);
            return { success: false, provider: 'TWILIO', error: err.message };
        }
    }

    // 2. Netgsm (Turkey)
    const netgsmUser = process.env.NETGSM_USER;
    const netgsmPass = process.env.NETGSM_PASS;
    const netgsmHeader = process.env.NETGSM_HEADER || 'MOTOVIBE';

    if (netgsmUser && netgsmPass) {
        try {
            const response = await fetch('https://api.netgsm.com.tr/sms/send/get', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    usercode: netgsmUser,
                    password: netgsmPass,
                    msgheader: netgsmHeader,
                    gsm: cleanedPhone.replace('+', ''),
                    message: message
                })
            });
            const text = await response.text();
            console.log(`[SMSService] 📱 Netgsm yanıtı: ${text}`);
            return { success: text.startsWith('00') || text.startsWith('01') || text.startsWith('02'), provider: 'NETGSM', response: text };
        } catch (err) {
            console.error('[SMSService] Netgsm Hatası:', err.message);
            return { success: false, provider: 'NETGSM', error: err.message };
        }
    }

    // 3. Fallback when provider credentials are not set
    if (!isProd) {
        console.log(`\n======================================================`);
        console.log(`📱 [SMS DEV LOG - Provider Tanımlı Değil]`);
        console.log(`📞 Alıcı: ${cleanedPhone}`);
        console.log(`💬 Mesaj: ${message}`);
        console.log(`======================================================\n`);
    }

    return {
        success: !isProd,
        provider: 'NONE',
        isMock: !isProd,
        note: 'SMS gateway henüz yapılandırılmamış. Geliştirme ortamında simüle edildi.'
    };
}

/**
 * Sends SOS Emergency SMS/WhatsApp alerts to emergency contact
 */
export async function sendSOSAlert({ toPhone, riderName, lat, lng, severity = 'CRITICAL' }) {
    if (!toPhone) return { success: false, reason: 'NO_PHONE' };

    const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
    const alertMessage = `🚨 VIBE-SOS ACİL DURUM: ${riderName} isimli sürücü kaza yapmış olabilir! (Seviye: ${severity}). Konum: ${mapsUrl}`;

    return await sendSMS({
        to: toPhone,
        message: alertMessage
    });
}
