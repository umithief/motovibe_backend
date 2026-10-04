import { Client } from 'ssh2';
import 'dotenv/config';
import { getSshConfig } from './config/deploy.js';

const SSH_CONFIG = getSshConfig();

const conn = new Client();

conn.on('ready', () => {
    conn.exec('pm2 logs motovibe-api --err --lines 40 --nostream', (err, stream) => {
        if (err) throw err;
        let output = '';
        stream.on('data', d => { output += d.toString(); });
        stream.stderr.on('data', d => { output += d.toString(); });
        stream.on('close', () => {
            console.log('--- ERR LOGS ---');
            console.log(output);
            conn.end();
        });
    });
}).connect(SSH_CONFIG);
