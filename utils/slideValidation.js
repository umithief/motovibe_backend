const types = new Set(['ride', 'route', 'post', 'product', 'shop', 'url', 'none']);
const textFields = { title: 160, subtitle: 400, actionLabel: 80, actionTarget: 2048, imageUrl: 2048 };
const safeUrl = value => {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }
    catch (_) { return false; }
};
const imageUrl = value => safeUrl(value) || (/^(?:\/api\/)?uploads\/[A-Za-z0-9_./-]+$/.test(value) && !value.includes('..'));
export const validateSlideBody = (body, { partial = false } = {}) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Slayt bilgileri zorunludur.');
    const clean = {};
    for (const [field, max] of Object.entries(textFields)) {
        if (body[field] === undefined) continue;
        if (typeof body[field] !== 'string' || body[field].length > max) throw new Error(`Geçersiz ${field}.`);
        clean[field] = body[field].trim();
    }
    for (const field of ['title', 'imageUrl']) {
        if ((!partial || field in clean) && !clean[field]) throw new Error(`${field} zorunludur.`);
    }
    if (clean.imageUrl && !imageUrl(clean.imageUrl)) throw new Error('Geçersiz görsel adresi.');
    if (body.actionType !== undefined) {
        if (!types.has(body.actionType)) throw new Error('Geçersiz eylem türü.');
        clean.actionType = body.actionType;
    }
    if (clean.actionTarget && /^(?:javascript|data|vbscript):/i.test(clean.actionTarget)) throw new Error('Güvensiz eylem hedefi.');
    if (clean.actionType === 'url' && !safeUrl(clean.actionTarget || '')) throw new Error('Geçersiz eylem adresi.');
    if (['ride','route','post','product'].includes(clean.actionType) && !/^[a-f0-9]{24}$/i.test(clean.actionTarget || '')) throw new Error('Geçersiz eylem hedefi.');
    if (body.isActive !== undefined) {
        if (typeof body.isActive !== 'boolean') throw new Error('Geçersiz aktiflik bilgisi.');
        clean.isActive = body.isActive;
    }
    if (body.order !== undefined) {
        if (!Number.isSafeInteger(body.order) || body.order < 0) throw new Error('Geçersiz sıralama.');
        clean.order = body.order;
    }
    if (body.accentColor !== undefined) {
        if (typeof body.accentColor !== 'string' || !/^#[a-f0-9]{6}$/i.test(body.accentColor)) throw new Error('Geçersiz renk.');
        clean.accentColor = body.accentColor;
    }
    for (const field of ['startDate','endDate']) {
        if (body[field] === undefined) continue;
        if (body[field] !== null && (typeof body[field] !== 'string' || Number.isNaN(Date.parse(body[field])))) throw new Error('Geçersiz tarih.');
        clean[field] = body[field];
    }
    if (clean.startDate && clean.endDate && new Date(clean.startDate) > new Date(clean.endDate)) throw new Error('Tarih aralığı geçersiz.');
    return clean;
};
