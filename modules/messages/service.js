// Shared by REST and socket sends. A retry reuses the client-generated tempId.
export async function createMessageOnce(MessageModel, values) {
    const { tempId, sender, type, content } = values;
    if (type === 'VOICE' || type === 'IMAGE') {
        let url;
        try { url = new URL(content); } catch { /* validated below */ }
        if (!url || !['http:', 'https:'].includes(url.protocol) || !url.hostname) {
            const error = new Error('Medya yüklenmeden mesaj gönderilemez.');
            error.statusCode = 400;
            error.status = 'fail';
            throw error;
        }
    }
    if (tempId != null && (typeof tempId !== 'string' || !tempId.trim() || tempId.length > 128)) {
        const error = new Error('Geçersiz mesaj kimliği.');
        error.statusCode = 400;
        error.status = 'fail';
        throw error;
    }
    const key = tempId ? { sender, tempId } : null;
    const replay = (message) => {
        if (String(message.conversationId) !== String(values.conversationId)) {
            const error = new Error('Mesaj kimliği başka bir sohbette kullanılmış.');
            error.statusCode = 409;
            error.status = 'fail';
            throw error;
        }
        return { message, created: false };
    };
    if (key) {
        const existing = await MessageModel.findOne(key);
        if (existing) return replay(existing);
    }
    try {
        return { message: await MessageModel.create(values), created: true };
    } catch (error) {
        if (key && error.code === 11000) {
            const existing = await MessageModel.findOne(key);
            if (existing) return replay(existing);
        }
        throw error;
    }
}
