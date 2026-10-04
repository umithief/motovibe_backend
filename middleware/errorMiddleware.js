import AppError from '../utils/appError.js';

const errorPayload = (message, requestId, field) => ({
    status: 'error',
    message,
    ...(field ? { field } : {}),
    ...(requestId ? { requestId } : {}),
});

export const apiNotFound = (req, res, next) => {
    next(new AppError(`API endpoint bulunamadi: ${req.method} ${req.originalUrl}`, 404));
};

export const globalErrorHandler = (err, req, res, next) => {
    if (res.headersSent) return next(err);

    let statusCode = err.statusCode || err.status || 500;
    let message = err.message;
    let field = err.field;

    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        statusCode = 400;
        message = 'Gecersiz JSON govdesi.';
    } else if (err.name === 'CastError') {
        statusCode = 400;
        message = `Gecersiz parametre: ${err.path || 'id'}`;
    } else if (err.name === 'ValidationError') {
        statusCode = 422;
        message = Object.values(err.errors || {}).map((value) => value.message).join(', ') || 'Dogrulama hatasi.';
    } else if (err.code === 11000) {
        statusCode = 409;
        field = Object.keys(err.keyValue || err.keyPattern || {})[0];
        message = field ? `${field} zaten kullanimda.` : 'Kayit zaten mevcut.';
    } else if (err.name === 'JsonWebTokenError') {
        statusCode = 401;
        message = 'Gecersiz token. Lutfen tekrar giris yapin.';
    } else if (err.name === 'TokenExpiredError') {
        statusCode = 401;
        message = 'Token suresi doldu. Lutfen tekrar giris yapin.';
    } else if (err.type === 'entity.too.large' || err.code === 'LIMIT_FILE_SIZE') {
        statusCode = 413;
        message = 'Istek govdesi izin verilen boyutu asiyor.';
    }

    if (statusCode >= 500 && !err.isOperational) {
        console.error(`[${req.id || 'request-id-yok'}] Beklenmeyen hata`, err);
        message = 'Beklenmeyen bir sunucu hatasi olustu.';
    } else if (statusCode >= 500) {
        console.error(`[${req.id || 'request-id-yok'}] Operasyonel sunucu hatasi`, err.message);
    }

    return res.status(statusCode).json(errorPayload(message || 'Istek islenemedi.', req.id, field));
};
