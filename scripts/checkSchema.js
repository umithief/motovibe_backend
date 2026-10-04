import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import VibeConfig from '../models/VibeConfig.js';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

const checkSchema = async () => {
    try {
        console.log('Checking VibeConfig Schema Paths...');

        // Ensure connection to trigger any model init if lazy (though import usually does it)
        const pathType = VibeConfig.schema.path('timeDecay.maxAgeDays');
        console.log('timeDecay.maxAgeDays path:', pathType ? 'EXISTS' : 'MISSING');

        if (pathType) {
            console.log('Type:', pathType.instance);
            console.log('Default:', pathType.defaultValue);
        }

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
};

checkSchema();
