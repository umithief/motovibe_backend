import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const KEY_PATH = 'C:/Users/ishak/Downloads/ssh-key-2025-11-20.key';
const SSH_HOST = 'root@31.210.36.57';
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
    'package.json',
    '.env'
];

function getLocalFiles(dirOrFile, fileList = []) {
    const fullPath = path.resolve(dirOrFile);
    if (!fs.existsSync(fullPath)) return fileList;

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
        const items = fs.readdirSync(fullPath);
        for (const item of items) {
            if (item === 'node_modules' || item === 'uploads' || item.startsWith('.')) {
                if (item !== '.env') continue;
            }
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

try {
    console.log('Fetching remote hashes...');
    const remoteCmd = `find ${REMOTE_BASE_DIR} -maxdepth 4 -type f -exec md5sum {} + 2>/dev/null`;
    const sshCmd = `ssh -o StrictHostKeyChecking=no -i "${KEY_PATH}" ${SSH_HOST} "${remoteCmd}"`;
    const stdout = execSync(sshCmd, { encoding: 'utf-8' });

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
        console.log('✅ ALL_FILES_UP_TO_DATE (No unsent backend data found)');
        process.exit(0);
    }

    console.log(`Need to upload ${filesToUpload.length} files...`);

    for (const rel of filesToUpload) {
        console.log(`Uploading: ${rel}`);
        const localPath = path.resolve(rel);
        const remotePath = `${REMOTE_BASE_DIR}/${rel}`;
        const remoteDir = path.dirname(remotePath).replace(/\\/g, '/');
        
        // Ensure remote dir exists
        execSync(`ssh -o StrictHostKeyChecking=no -i "${KEY_PATH}" ${SSH_HOST} "mkdir -p ${remoteDir}"`);
        // SCP file
        execSync(`scp -o StrictHostKeyChecking=no -i "${KEY_PATH}" "${localPath}" "${SSH_HOST}:${remotePath}"`);
    }

    console.log('UPLOAD_COMPLETE');
    console.log('Restarting PM2...');
    execSync(`ssh -o StrictHostKeyChecking=no -i "${KEY_PATH}" ${SSH_HOST} "export HOME=/root; cd /var/www/motovibe && npm install --production && /usr/bin/pm2 restart motovibe-api || /usr/bin/pm2 restart all"`, { stdio: 'inherit' });
    console.log('\\nPM2_RESTARTED');

} catch (e) {
    console.error('Error during sync:', e.message);
}
