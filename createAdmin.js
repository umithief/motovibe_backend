import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) throw new Error('MONGO_URI ortam degiskeni zorunludur.');

import User from './models/User.js';

const createAdmin = async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected to MongoDB');

        const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
        const adminPassword = process.env.ADMIN_PASSWORD;
        if (!adminEmail || !adminPassword || adminPassword.length < 12) {
            throw new Error('ADMIN_EMAIL ve en az 12 karakterli ADMIN_PASSWORD zorunludur.');
        }

        // Check if admin exists
        const existingAdmin = await User.findOne({ email: adminEmail });
        if (existingAdmin) {
            console.log('⚠️ Admin user already exists. Updating credentials...');

            const salt = await bcrypt.genSalt(10);
            existingAdmin.password = await bcrypt.hash(adminPassword, salt);
            existingAdmin.isAdmin = true;
            await existingAdmin.save();

            console.log('✅ Admin credentials updated successfully.');
            console.log(`📧 Email: ${adminEmail}`);

            await mongoose.disconnect();
            process.exit(0);
        }

        // Create new admin
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(adminPassword, salt);

        const newAdmin = new User({
            name: 'MotoVibe Admin',
            email: adminEmail,
            password: hashedPassword,
            isAdmin: true,
            rank: 'MotoVibe Master'
        });

        await newAdmin.save();
        console.log(`✅ Admin user created successfully: ${adminEmail}`);

    } catch (error) {
        console.error('❌ Error creating admin:', error);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
};

createAdmin();
