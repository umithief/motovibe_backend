import mongoose from 'mongoose';
import { getMongoUri } from './env.js';
let connecting;
export const connectDatabase = () => {
    if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose);
    if (!connecting) connecting = mongoose.connect(getMongoUri()).catch(error => {
        connecting = undefined;
        throw error;
    });
    return connecting;
};
