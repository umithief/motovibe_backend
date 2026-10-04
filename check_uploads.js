import { Client } from 'ssh2';
import 'dotenv/config';
import { getSshConfig } from './config/deploy.js';
const conn = new Client();
conn.on('ready', () => {
    // Create a simple default avatar SVG converted to PNG using ImageMagick on server
    const cmd = `
cd /var/www/motovibe/uploads && 
if [ ! -f default-avatar.png ]; then
  echo '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="#1a1a2e"/><circle cx="100" cy="75" r="35" fill="#4a4a6a"/><ellipse cx="100" cy="175" rx="60" ry="50" fill="#4a4a6a"/></svg>' > /tmp/default-avatar.svg
  if command -v convert &> /dev/null; then
    convert /tmp/default-avatar.svg default-avatar.png
    echo "Created default-avatar.png via ImageMagick"
  elif command -v rsvg-convert &> /dev/null; then
    rsvg-convert /tmp/default-avatar.svg -o default-avatar.png
    echo "Created default-avatar.png via rsvg-convert"
  else
    cp /tmp/default-avatar.svg default-avatar.png
    echo "Saved as PNG (actually SVG - no converter found)"
  fi
else
  echo "default-avatar.png already exists"
fi
ls -la default-avatar*
`;
    conn.exec(cmd, (err, stream) => {
        if (err) throw err;
        stream.on('close', () => conn.end())
              .on('data', d => process.stdout.write(d.toString()))
              .stderr.on('data', d => process.stderr.write(d.toString()));
    });
}).connect(getSshConfig());
