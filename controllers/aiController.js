import AppError from '../utils/appError.js';
import catchAsync from '../utils/catchAsync.js';

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_ITEMS = 8;

const normalizeText = (value, maxLength = MAX_MESSAGE_LENGTH) => {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, maxLength);
};

const normalizeHistory = (history) => {
    if (!Array.isArray(history)) return [];

    return history
        .slice(-MAX_HISTORY_ITEMS)
        .map((item) => {
            const role = item?.role === 'model' ? 'model' : 'user';
            const text = normalizeText(item?.text, 1200);
            if (!text) return null;
            return {
                role,
                parts: [{ text }]
            };
        })
        .filter(Boolean);
};

const extractGeminiText = (payload) => {
    const parts = payload?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return '';

    return parts
        .map((part) => (typeof part?.text === 'string' ? part.text.trim() : ''))
        .filter(Boolean)
        .join('\n\n')
        .trim();
};

export const chatWithMotoVibeAi = catchAsync(async (req, res, next) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return next(new AppError('Motonom AI servisi su anda yapilandirilmamis.', 503));
    }

    const message = normalizeText(req.body?.message);
    if (!message) {
        return next(new AppError('Mesaj bos olamaz.', 400));
    }

    const systemPrompt = [
        'You are Motonom AI, an assistant inside a motorcycle community app.',
        'Answer in the user language, keep replies practical, concise, and safety-aware.',
        'Do not encourage unsafe riding, illegal speed, or riding without protective gear.'
    ].join(' ');

    const contents = [
        {
            role: 'user',
            parts: [{ text: systemPrompt }]
        },
        {
            role: 'model',
            parts: [{ text: 'Anladim. Motonom icinde guvenli ve pratik cevaplar verecegim.' }]
        },
        ...normalizeHistory(req.body?.history),
        {
            role: 'user',
            parts: [{ text: message }]
        }
    ];

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(DEFAULT_MODEL)}:generateContent`;
    const upstream = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
            contents,
            generationConfig: {
                temperature: 0.6,
                maxOutputTokens: 500
            }
        })
    });

    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
        const messageFromApi =
            payload?.error?.message ||
            'Motonom AI yanit uretirken bir hata oluştu.';
        return next(new AppError(messageFromApi, upstream.status >= 500 ? 502 : upstream.status));
    }

    const reply = extractGeminiText(payload);
    if (!reply) {
        return next(new AppError('Motonom AI su anda yanit uretemedi.', 502));
    }

    res.status(200).json({
        status: 'success',
        data: {
            reply,
            model: DEFAULT_MODEL
        }
    });
});
