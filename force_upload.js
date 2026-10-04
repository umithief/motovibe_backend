import { Client } from 'ssh2';
import 'dotenv/config';
import { getSshConfig } from './config/deploy.js';
import fs from 'fs';

const conn = new Client();
conn.on('ready', () => {
    console.log('Connected. Uploading...');
    conn.sftp((err, sftp) => {
        if (err) throw err;
        const localFile = 'routes/uploadRoutes.js';
        const remoteFile = '/var/www/motovibe/routes/uploadRoutes.js';
        sftp.fastPut(localFile, remoteFile, (err) => {
            if (err) throw err;
            console.log('Upload success.');
            conn.exec('export HOME=/root && pm2 restart motovibe-api', (err, stream) => {
                if (err) throw err;
                stream.on('data', d => process.stdout.write(d.toString()));
                stream.stderr.on('data', d => process.stderr.write(d.toString()));
                stream.on('close', () => conn.end());
            });
        });
    });
}).connect(getSshConfig());
