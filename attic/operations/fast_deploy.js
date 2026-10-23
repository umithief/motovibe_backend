import { Client } from 'ssh2';
import 'dotenv/config';
import { getSshConfig } from "../../config/deploy.js";
import fs from 'fs';

const conn = new Client();
conn.on('ready', () => {
    conn.sftp((err, sftp) => {
        if (err) throw err;
        
        const filesToUpload = [
            { local: 'server.js', remote: '/var/www/motovibe/server.js' },
            { local: 'controllers/storyController.js', remote: '/var/www/motovibe/controllers/storyController.js' },
            { local: 'controllers/userController.js', remote: '/var/www/motovibe/controllers/userController.js' },
            { local: 'controllers/profileThemeController.js', remote: '/var/www/motovibe/controllers/profileThemeController.js' },
            { local: 'utils/profileThemes.js', remote: '/var/www/motovibe/utils/profileThemes.js' },
            { local: 'models/User.js', remote: '/var/www/motovibe/models/User.js' },
            { local: 'routes/eventRoutes.js', remote: '/var/www/motovibe/routes/eventRoutes.js' },
            { local: 'routes/slideRoutes.js', remote: '/var/www/motovibe/routes/slideRoutes.js' },
            { local: 'routes/userRoutes.js', remote: '/var/www/motovibe/routes/userRoutes.js' }
        ];

        let uploadedCount = 0;

        filesToUpload.forEach(file => {
            console.log(`Uploading ${file.local}...`);
            sftp.fastPut(file.local, file.remote, (err) => {
                if (err) {
                    console.error(`Failed to upload ${file.local}:`, err);
                    throw err;
                }
                
                uploadedCount++;
                if (uploadedCount === filesToUpload.length) {
                    console.log('All files uploaded! Restarting PM2...');
                    conn.exec('pm2 restart motovibe || pm2 restart motovibe-api || pm2 restart all', (err, stream) => {
                        stream.on('close', () => {
                            conn.end();
                            console.log('Done.');
                        }).on('data', d => process.stdout.write(d.toString()));
                    });
                }
            });
        });
    });
}).connect(getSshConfig());
