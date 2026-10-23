import { Client } from 'ssh2';
import 'dotenv/config';
import { getSshConfig } from "../../config/deploy.js";
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const SSH_CONFIG = getSshConfig();
const REMOTE_BASE_DIR = '/var/www/motovibe';

const IGNORE_DIRS = ['node_modules', 'uploads', '.git'];
const IGNORE_FILES = ['release.tar.gz', 'uploads.tar.gz', 'check_output.txt', '.gitignore'];

function scanDirectory(dirPath, fileList = []) {
    const items = fs.readdirSync(dirPath);
    for (const item of items) {
        const fullPath = path.join(dirPath, item);
        const relPath = path.relative(process.cwd(), fullPath).replace(/\\/g, '/');
        if (relPath === 'node_modules' || relPath === 'uploads' || relPath === '.git') continue;
        if (item === 'node_modules' || item === '.git') continue;
        if (item.startsWith('.') && item !== '.env' && item !== '.env.example') continue;

        if (IGNORE_FILES.includes(item)) continue;

        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            scanDirectory(fullPath, fileList);
        } else {
            fileList.push(relPath);
        }
    }
    return fileList;
}

const allLocalFiles = scanDirectory(process.cwd());
console.log(`Scanning ${allLocalFiles.length} local files...`);

function getMd5(filePath) {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(buffer).digest('hex');
}

const conn = new Client();

conn.on('ready', () => {
    console.log('SSH Connected.');

    const remoteCmd = `find ${REMOTE_BASE_DIR} -type f ! -path "*/node_modules/*" ! -path "${REMOTE_BASE_DIR}/uploads/*" -exec md5sum {} + 2>/dev/null`;

    conn.exec(remoteCmd, (err, stream) => {
        if (err) throw err;
        let stdout = '';
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
                const localMd5 = getMd5(relPath);
                if (remoteHashes[relPath] !== localMd5) {
                    filesToUpload.push(relPath);
                }
            });

            if (filesToUpload.length === 0) {
                console.log('✅ ALL_FILES_UP_TO_DATE');
                conn.end();
                return;
            }

            console.log(`Uploading ${filesToUpload.length} files...`);

            const dirsToCreate = [...new Set(filesToUpload.map(f => path.posix.dirname(f)))].filter(d => d !== '.');
            const mkdirCmd = dirsToCreate.length ? dirsToCreate.map(d => `mkdir -p "${REMOTE_BASE_DIR}/${d}"`).join(' && ') : 'echo ok';

            conn.exec(mkdirCmd, (err, mkStream) => {
                if (err) throw err;
                mkStream.resume();
                mkStream.on('close', () => {
                    conn.sftp((err, sftp) => {
                        if (err) throw err;

                        let index = 0;
                        function sendFile() {
                            if (index >= filesToUpload.length) {
                                console.log('UPLOAD_FINISHED');
                                conn.exec('pm2 restart motovibe || pm2 restart motovibe-api || pm2 restart all', (err, pStream) => {
                                    if (pStream) {
                                        pStream.resume();
                                        pStream.on('data', d => process.stdout.write(d.toString()));
                                        pStream.on('close', () => {
                                            console.log('\nPM2_RESTARTED');
                                            conn.end();
                                        });
                                    } else {
                                        conn.end();
                                    }
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
        });
    });
}).connect(SSH_CONFIG);
