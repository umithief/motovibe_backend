import { Client } from 'ssh2';
import path from 'path';
import fs from 'fs';
import 'dotenv/config';
import { getSshConfig } from "../../config/deploy.js";


const conn = new Client();

const SSH_CONFIG = getSshConfig();
const pinnedHostHash = process.env.DEPLOY_HOST_KEY_SHA256_HEX?.trim().toLowerCase();
if (!pinnedHostHash || !/^[a-f0-9]{64}$/.test(pinnedHostHash)) {
  throw new Error('Verified DEPLOY_HOST_KEY_SHA256_HEX is required before SSH deployment.');
}
SSH_CONFIG.hostHash = 'sha256';
SSH_CONFIG.hostVerifier = (hash) => hash === pinnedHostHash;
const deployHost = SSH_CONFIG.host;

const REMOTE_DIR = '/var/www/motovibe';
const LOCAL_ARCHIVE = path.resolve(process.argv[2] || process.env.RELEASE_ARCHIVE || 'dist-release.tar.gz');
if (!fs.existsSync(LOCAL_ARCHIVE)) {
  throw new Error('Önce npm run release:build ile üretim paketini oluşturmalısın.');
}
const REMOTE_ARCHIVE = REMOTE_DIR + '/release.tar.gz';
// Existing database and provider settings stay on the server.
const baseUrl = process.env.BASE_URL?.trim();
if (!baseUrl) throw new Error('Canli deploy icin HTTPS BASE_URL zorunludur.');
let parsedBaseUrl;
try {
  parsedBaseUrl = new URL(baseUrl);
} catch {
  throw new Error('BASE_URL gecerli bir HTTPS origin olmali.');
}
if (parsedBaseUrl.protocol !== 'https:' || parsedBaseUrl.username || parsedBaseUrl.password ||
    parsedBaseUrl.pathname !== '/' || parsedBaseUrl.search || parsedBaseUrl.hash ||
    (parsedBaseUrl.port && parsedBaseUrl.port !== '443')) {
  throw new Error('Canli BASE_URL HTTPS origin olmali; path, credential ve ozel port kullanilamaz.');
}
const apiHost = parsedBaseUrl.hostname;
const getRemoteTlsPath = (name) => {
  const value = process.env[name]?.trim() ?? '';
  const allowed = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_./-';
  if (!value.startsWith('/') || value.includes('..') || [...value].some((char) => !allowed.includes(char))) {
    throw new Error(name + ' mutlak, guvenli bir sunucu yolu olmali.');
  }
  return value;
};
const tlsCertPath = getRemoteTlsPath('TLS_CERT_PATH');
const tlsKeyPath = getRemoteTlsPath('TLS_KEY_PATH');
const corsOrigins = process.env.CORS_ORIGINS?.trim();
if (!corsOrigins) throw new Error('Deploy icin CORS_ORIGINS zorunludur.');
const allowedUploadOrigins = [...new Set(corsOrigins.split(',').map((value) => {
  const origin = value.trim();
  if (!origin || origin === '*') {
    throw new Error('Canli upload CORS icin wildcard origin kullanilamaz.');
  }
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error('CORS_ORIGINS gecerli origin URL listesi olmali.');
  }
  if (parsed.protocol !== 'https:' || parsed.origin !== origin) {
    throw new Error('Canli CORS originleri HTTPS ve path icermeyen origin olmalidir.');
  }
  return parsed.origin;
}))];
if (allowedUploadOrigins.length === 0) {
  throw new Error('Upload CORS allowlist bos olamaz.');
}
const uploadCorsMap = [
  'map $http_origin $motonom_upload_cors_origin {',
  '    default "";',
  ...allowedUploadOrigins.map((origin) => '    "' + origin + '" $http_origin;'),
  '}',
].join(String.fromCharCode(10));

console.log('Connecting to SSH...');

conn.on('ready', () => {
  console.log('SSH connection ready!');
  
  // Step 1: Ensure directory exists on remote and upload
  conn.sftp((err, sftp) => {
    if (err) throw err;
    
    console.log(`Ensuring remote directory ${REMOTE_DIR} exists...`);
    sftp.mkdir(REMOTE_DIR, (err) => {
      // Ignore if directory already exists
      
      console.log(`Starting file upload: ${LOCAL_ARCHIVE} -> ${REMOTE_ARCHIVE}`);
      
      const stats = fs.statSync(LOCAL_ARCHIVE);
      const fileSize = stats.size;
      let uploadedBytes = 0;
      
      const readStream = fs.createReadStream(LOCAL_ARCHIVE);
      const writeStream = sftp.createWriteStream(REMOTE_ARCHIVE);
      
      readStream.on('data', (chunk) => {
        uploadedBytes += chunk.length;
        const progress = ((uploadedBytes / fileSize) * 100).toFixed(2);
        process.stdout.write(`Uploading: ${progress}% (${(uploadedBytes / 1024 / 1024).toFixed(2)} MB / ${(fileSize / 1024 / 1024).toFixed(2)} MB)\r`);
      });
      
      writeStream.on('close', () => {
        console.log('\nUpload completed successfully!');
        runRemoteSetup();
      });
      
      writeStream.on('error', (err) => {
        console.error('\nUpload error:', err);
        conn.end();
      });
      
      readStream.pipe(writeStream);
    });
  });
}).connect(SSH_CONFIG);

function executeCommand(cmd) {
  return new Promise((resolve, reject) => {
    console.log(`Executing: ${cmd}`);
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      
      let stdout = '';
      let stderr = '';
      
      stream.on('close', (code, signal) => {
        if (code !== 0) {
          console.error(`Command failed with code ${code}. Error: ${stderr}`);
          reject(new Error(`Command failed with code ${code}`));
        } else {
          resolve(stdout);
        }
      });
      
      stream.on('data', (data) => {
        stdout += data;
        process.stdout.write(data);
      });
      
      stream.stderr.on('data', (data) => {
        stderr += data;
        process.stderr.write(data);
      });
    });
  });
}

function writeRemoteFile(remotePath, content, mode = 0o600) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      const stream = sftp.createWriteStream(remotePath, { mode, flag: 'w' });
      stream.once('error', reject);
      stream.once('close', resolve);
      stream.end(content);
    });
  });
}
async function runRemoteSetup() {
  try {
    await executeCommand('test -r ' + tlsCertPath + ' && test -r ' + tlsKeyPath + ' && test -r ' + REMOTE_DIR + '/.env');
    console.log('\n--- Starting Remote Server Configuration ---');
    
    // Runtime upgrades are a separate operation. Refuse unsupported Node
    // instead of installing a different major version during deployment.
    await executeCommand("node -e 'const [major,minor]=process.versions.node.split(\".\").map(Number); if(major<20 || (major===20 && minor<19)) process.exit(1)'");
    // 1. Install prerequisites (curl, gnupg, nginx, git)
    await executeCommand('apt-get update && apt-get install -y curl gnupg nginx build-essential');
    
    // 3. Install PM2 globally if not exists
    const hasPm2 = await executeCommand('pm2 -v').catch(() => null);
    if (!hasPm2) {
      console.log('Installing PM2 globally...');
      await executeCommand('npm install -g pm2');
    }
    
    // 4. Extract tarball
    console.log('Extracting backend codebase...');
    await executeCommand(`tar -xzf ${REMOTE_ARCHIVE} -C ${REMOTE_DIR}`);
    await executeCommand(`rm -f ${REMOTE_ARCHIVE}`); // Clean up tarball
    
    // Install the locked runtime before the server-only environment repair.
    console.log('Installing production dependencies...');
    await executeCommand(`cd ${REMOTE_DIR} && npm ci --omit=dev`);

    // Never download the production .env or replace credentials from local
    // settings. The helper validates preservation and creates a private backup.
    const publicControls = { NODE_ENV: 'production', PORT: '5001', BASE_URL: baseUrl,
      CORS_ORIGINS: allowedUploadOrigins.join(','), SEED_DEMO_DATA: 'false' };
    const environmentHelper = fs.readFileSync(new URL('./utils/deploymentEnvironment.js', import.meta.url), 'utf8')
      .replace('export function mergeProductionEnvironment', 'function mergeProductionEnvironment');
    const environmentRepairScript = environmentHelper + `
import fs from 'node:fs';
const envPath = ${JSON.stringify(REMOTE_DIR + '/.env')};
if (!fs.lstatSync(envPath).isFile()) throw new Error('Production env must be a regular file.');
const original = fs.readFileSync(envPath, 'utf8');
const merged = mergeProductionEnvironment(original, ${JSON.stringify(publicControls)});
const stamp = Date.now() + '-' + process.pid;
fs.writeFileSync(envPath + '.backup-' + stamp, original, {mode: 0o600, flag: 'wx'});
const temporary = envPath + '.next-' + stamp;
fs.writeFileSync(temporary, merged, {mode: 0o600, flag: 'wx'});
fs.renameSync(temporary, envPath);
console.log('Production settings preserved; public release controls updated.');
`;
    const remoteRepairPath = REMOTE_DIR + '/.deploy-environment.mjs';
    await writeRemoteFile(remoteRepairPath, environmentRepairScript, 0o600);
    try {
      await executeCommand('node ' + remoteRepairPath);
    } finally {
      await executeCommand('rm -f ' + remoteRepairPath);
    }
    await writeRemoteFile('/etc/nginx/conf.d/motovibe-uploads-cors.conf', uploadCorsMap, 0o644);
    const nginxConfig = `server {
    listen 80;
    server_name ${apiHost};
    return 308 https://$host$request_uri;
}
server {
    listen 443 ssl http2;
    server_name ${apiHost};
    ssl_certificate ${tlsCertPath};
    ssl_certificate_key ${tlsKeyPath};
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:5001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /api/uploads/ {
        alias ${REMOTE_DIR}/uploads/;
        access_log off;
        expires max;
        add_header Access-Control-Allow-Origin $motonom_upload_cors_origin always;
        add_header Access-Control-Allow-Methods "GET, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, Range" always;
        add_header Access-Control-Expose-Headers "Content-Range, Content-Length, Accept-Ranges" always;
        add_header Vary Origin always;
        if ($request_method = OPTIONS) {
            return 204;
        }
    }
}`;
    
    await writeRemoteFile('/etc/nginx/sites-available/motovibe', nginxConfig, 0o644);
    await executeCommand('ln -sf /etc/nginx/sites-available/motovibe /etc/nginx/sites-enabled/motovibe');
    await executeCommand('rm -f /etc/nginx/sites-enabled/default'); // Remove default
    
    console.log('Restarting Nginx...');
    await executeCommand('nginx -t');
    await executeCommand('systemctl restart nginx');
    
    // 8. Start/Restart PM2 process
    console.log('Starting application under PM2...');
    await executeCommand('pm2 delete motovibe || true');
    await executeCommand('pm2 delete motovibe-api || true');
    await executeCommand(`cd ${REMOTE_DIR} && pm2 start ecosystem.config.cjs`);
    await executeCommand('pm2 save');
    
    console.log('\n=========================================');
    console.log('🎉 DEPLOYMENT COMPLETED SUCCESSFULLY!');
    console.log('API is live at: ' + baseUrl);
    console.log('=========================================');
  } catch (err) {
    console.error('\nDeployment error occurred:', err);
    process.exitCode = 1;
  } finally {
    conn.end();
  }
}
