import { Client } from 'ssh2';
import 'dotenv/config';
import { getSshConfig } from './config/deploy.js';
const conn = new Client();
conn.on('ready', () => {
    conn.exec('export HOME=/root && pm2 logs motovibe-api --out --lines 30 --nostream', (err, stream) => {
        if (err) throw err;
        stream.on('data', d => process.stdout.write(d.toString()));
        stream.stderr.on('data', d => process.stderr.write(d.toString()));
        stream.on('close', () => conn.end());
    });
}).connect(getSshConfig());
