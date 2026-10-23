import admin from 'firebase-admin';
export const initializeFirebase = () => {
    // applicationDefault() initializes lazily, so a missing key only surfaces
    // when the first push is sent. Say it at startup instead.
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        console.warn('[Firebase] GOOGLE_APPLICATION_CREDENTIALS is not set; push notifications will fail.');
    }
    if (!admin.apps.length) admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        ...(process.env.FIREBASE_STORAGE_BUCKET ? { storageBucket: process.env.FIREBASE_STORAGE_BUCKET } : {})
    });
    return admin.app();
};
