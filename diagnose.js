import { Client } from 'ssh2';
import 'dotenv/config';
import { getSshConfig } from './config/deploy.js';

const conn = new Client();

const SSH_CONFIG = getSshConfig();

console.log('Connecting to SSH for diagnostics...');

conn.on('ready', () => {
  console.log('SSH connection ready!');
  runDiagnostics();
}).connect(SSH_CONFIG);

function executeCommand(cmd) {
  return new Promise((resolve) => {
    console.log(`\n--- Executing: ${cmd} ---`);
    conn.exec(cmd, (err, stream) => {
      if (err) {
        console.error(err);
        return resolve();
      }
      
      let stdout = '';
      stream.on('close', (code) => {
        console.log(`Exit code: ${code}`);
        resolve();
      });
      stream.on('data', (data) => {
        process.stdout.write(data);
      });
      stream.stderr.on('data', (data) => {
        process.stderr.write(data);
      });
    });
  });
}

async function runDiagnostics() {
  try {
    await executeCommand('ufw allow 80/tcp');
    await executeCommand('ufw allow 443/tcp');
    await executeCommand('ufw reload');
    await executeCommand('systemctl status nginx | grep Active');
    await executeCommand('netstat -tulpn | grep -E "nginx|5001"');
    await executeCommand('pm2 status');
    await executeCommand('pm2 logs motovibe-api --lines 20 --nostream');
    await executeCommand('ufw status');
  } catch (err) {
    console.error(err);
  } finally {
    conn.end();
  }
}
