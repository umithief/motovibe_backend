import { onRequest } from 'firebase-functions/v2/https';
import app from './server.js';

// Express uygulamasını Firebase HTTP fonksiyonu olarak dışa aktarıyoruz
export const api = onRequest({ memory: '2GiB', timeoutSeconds: 120 }, app);
