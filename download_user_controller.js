import { Client } from 'ssh2';
import 'dotenv/config';
import { getSshConfig } from './config/deploy.js';
import fs from 'fs';

const conn = new Client();
conn.on('ready', () => {
    conn.sftp((err, sftp) => {
        if (err) throw err;
        const remoteFile = '/var/www/motovibe/controllers/userController.js';
        const localFile = 'controllers/userController.js';
        sftp.fastGet(remoteFile, localFile, (err) => {
            if (err) throw err;
            console.log('Downloaded userController.js from server');
            conn.end();
        });
    });
}).connect(getSshConfig());
