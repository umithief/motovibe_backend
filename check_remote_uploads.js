import { Client } from 'ssh2';
import 'dotenv/config';
import { getSshConfig } from './config/deploy.js';

const conn = new Client();
const SSH_CONFIG = getSshConfig();

conn.on('ready', () => {
  conn.exec('ls -la /var/www/motovibe/uploads', (err, stream) => {
    if (err) throw err;
    stream.on('close', () => {
      conn.end();
    }).on('data', (data) => {
      process.stdout.write(data);
    }).stderr.on('data', (data) => {
      process.stderr.write(data);
    });
  });
}).connect(SSH_CONFIG);
