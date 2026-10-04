import { Client } from 'ssh2';
import 'dotenv/config';
import { getSshConfig } from './config/deploy.js';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const SSH_CONFIG = getSshConfig();
const REMOTE_BASE_DIR = '/var/www/motovibe';

const INCLUDE_PATHS = [
    'controllers',
    'models',
    'routes',
    'middleware',
    'services',
    'utils',
    'config',
    'validations',
    'realtime',
    'scripts',
    'api',
    'server.js',
    'socket.js',
    'radarSocket.js',
    'webrtcSignaling.js',
    'index.js',
    'ecosystem.config.cjs',
    'package.json'
];

function getLocalFiles(dirOrFile, fileList = []) {
    const fullPath = path.resolve(dirOrFile);
    if (!fs.existsSync(fullPath)) return fileList;

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
        const items = fs.readdirSync(fullPath);
        for (const item of items) {
            if (item === 'node_modules' || item === 'uploads' || item.startsWith('.')) continue;
            getLocalFiles(path.join(dirOrFile, item), fileList);
        }
    } else {
        const relPath = path.relative(process.cwd(), fullPath).replace(/\\/g, '/');
        fileList.push(relPath);
    }
    return fileList;
}

const allLocalFiles = [];
for (const item of INCLUDE_PATHS) {
    getLocalFiles(item, allLocalFiles);
}

console.log(`Analyzing ${allLocalFiles.length} local files...`);

const conn = new Client();

conn.on('ready', () => {
    console.log('SSH Connected.');

    const remoteCmd = `find ${REMOTE_BASE_DIR} -maxdepth 3 -type f -exec md5sum {} + 2>/dev/null`;
    
    conn.exec(remoteCmd, (err, stream) => {
        let stdout = '';
        if (err) throw err;

        stream.on('data', d => { stdout += d.toString(); });
        stream.on('close', () => {
            const remoteHashes = {};
            stdout.split('\n').forEach(line => {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 2) {
                    const hash = parts[0];
                    const fullPath = parts[1];
                    const rel = fullPath.replace(`${REMOTE_BASE_DIR}/`, '');
                    remoteHashes[rel] = hash;
                }
            });

            const filesToUpload = [];
            allLocalFiles.forEach(relPath => {
                const localBuffer = fs.readFileSync(relPath);
                const localHash = crypto.createHash('md5').update(localBuffer).digest('hex');
                if (remoteHashes[relPath] !== localHash) {
                    filesToUpload.push(relPath);
                }
            });

            if (filesToUpload.length === 0) {
                console.log('✅ ALL_FILES_UP_TO_DATE');
                conn.end();
                return;
            }

            console.log(`Uploading ${filesToUpload.length} files...`);

            conn.sftp((err, sftp) => {
                if (err) throw err;

                let index = 0;
                function sendFile() {
                    if (index >= filesToUpload.length) {
                        console.log('UPLOAD_COMPLETE');
                        conn.exec('pm2 restart motovibe || pm2 restart motovibe-api || pm2 restart all', (err, pStream) => {
                            pStream.on('data', d => process.stdout.write(d.toString()));
                            pStream.on('close', () => {
                                console.log('\nPM2_RESTARTED');
                                conn.end();
                            });
                        });
                        return;
                    }

                    const rel = filesToUpload[index];
                    const localPath = path.resolve(rel);
                    const remotePath = `${REMOTE_BASE_DIR}/${rel}`;
                    const content = fs.readFileSync(localPath);

                    sftp.writeFile(remotePath, content, (err) => {
                        if (err) {
                            console.log(`[${index + 1}/${filesToUpload.length}] FAIL: ${rel} (${err.message})`);
                        } else {
                            console.log(`[${index + 1}/${filesToUpload.length}] SUCCESS: ${rel}`);
                        }
                        index++;
                        sendFile();
                    });
                }

                sendFile();
            });
        });
    });
}).connect(SSH_CONFIG);
