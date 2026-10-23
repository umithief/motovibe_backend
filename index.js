import 'dotenv/config';
import { onRequest } from 'firebase-functions/v2/https';
import app from './app.js';
import { connectDatabase } from './config/database.js';
import { initializeFirebase } from './config/firebase.js';
import { validateRuntimeEnv } from './config/env.js';
import { globalErrorHandler } from './middleware/errorMiddleware.js';

export const api = onRequest({ memory: '2GiB', timeoutSeconds: 120 }, async (req, res) => {
    try {
        validateRuntimeEnv();
        initializeFirebase();
        await connectDatabase();
        app(req, res);
    } catch (error) { globalErrorHandler(error, req, res, () => {}); }
});
