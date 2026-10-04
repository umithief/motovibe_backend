import { Client } from 'ssh2';
import 'dotenv/config';
import { getSshConfig } from './config/deploy.js';
import fs from 'fs';
import path from 'path';

const conn = new Client();
const SSH_CONFIG = getSshConfig();

const REMOTE_DIR = '/var/www/motovibe';
const LOCAL_FILE = path.join(process.cwd(), 'server.js');
const REMOTE_FILE = REMOTE_DIR + '/server.js';

conn.on('ready', () => {
  conn.sftp((err, sftp) => {
    if (err) throw err;
    console.log('Uploading server.js...');
    sftp.fastPut(LOCAL_FILE, REMOTE_FILE, (err) => {
      if (err) throw err;
      console.log('Upload complete, restarting pm2...');
      conn.exec('cd /var/www/motovibe && pm2 restart motovibe-api', (err, stream) => {
        if (err) throw err;
        stream.on('close', () => {
          console.log('Restarted successfully!');
          conn.end();
        }).on('data', (data) => {
          process.stdout.write(data);
        }).stderr.on('data', (data) => {
          process.stderr.write(data);
        });
      });
    });
  });
}).connect(SSH_CONFIG);
