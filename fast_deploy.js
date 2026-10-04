import { Client } from 'ssh2';
import 'dotenv/config';
import { getSshConfig } from './config/deploy.js';
import fs from 'fs';

const conn = new Client();
conn.on('ready', () => {
    conn.sftp((err, sftp) => {
        if (err) throw err;
        
        const filesToUpload = [
            { local: 'models/Report.js', remote: '/var/www/motovibe/models/Report.js' },
            { local: 'models/Notification.js', remote: '/var/www/motovibe/models/Notification.js' },
            { local: 'controllers/reportController.js', remote: '/var/www/motovibe/controllers/reportController.js' },
            { local: 'routes/reportRoutes.js', remote: '/var/www/motovibe/routes/reportRoutes.js' },
            { local: 'server.js', remote: '/var/www/motovibe/server.js' },
            { local: 'controllers/routeController.js', remote: '/var/www/motovibe/controllers/routeController.js' }
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
