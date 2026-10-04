import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import VibeConfig from '../models/VibeConfig.js';

const envPath = 'c:\\Users\\ishak\\Downloads\\motovibe---premium-motosiklet-aksesuarları (18)\\.env';
dotenv.config({ path: envPath });

const checkConfig = async () => {
    try {
        const MONGO_URI = process.env.MONGO_URI;
        if (!MONGO_URI) throw new Error('MONGO_URI ortam degiskeni zorunludur.');
        await mongoose.connect(MONGO_URI);

        const config = await VibeConfig.findById('default_config').lean();

        const content = config ? JSON.stringify(config, null, 2) : 'No config found';

        const dumpPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'config_dump.json');
        fs.writeFileSync(dumpPath, content);

        console.log('Done writing to file');
        await mongoose.disconnect();
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
};

checkConfig();
