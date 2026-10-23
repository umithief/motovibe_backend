const { Client } = require('ssh2');
require('dotenv').config();
const fs = require('fs');

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} ortam degiskeni zorunludur.`);
  return value;
};
const SSH_CONFIG = {
  host: required('DEPLOY_HOST'),
  port: Number.parseInt(process.env.DEPLOY_PORT || '22', 10),
  username: required('DEPLOY_USERNAME'),
  password: required('DEPLOY_PASSWORD')
};

const conn = new Client();
conn.on('ready', () => {
  console.log('Client :: ready');
  conn.sftp((err, sftp) => {
    if (err) throw err;
    console.log('SFTP :: ready');
    const readStream = fs.createReadStream('uploads.tar.gz');
    const writeStream = sftp.createWriteStream('/var/www/motovibe/uploads.tar.gz');
    
    writeStream.on('close', () => {
      console.log('File transferred successfully');
      conn.exec('cd /var/www/motovibe && tar -xzf uploads.tar.gz', (err, stream) => {
        if (err) throw err;
        stream.on('close', (code, signal) => {
          console.log('Extraction complete, code: ' + code);
          conn.end();
        }).on('data', (data) => {
          process.stdout.write(data);
        }).stderr.on('data', (data) => {
          process.stderr.write(data);
        });
      });
    });
    
    readStream.pipe(writeStream);
  });
}).connect(SSH_CONFIG);
