import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

const data = {
  argv: process.argv,
  meta: import.meta.url,
  match: process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false
};

fs.writeFileSync('/tmp/pm2_diag.json', JSON.stringify(data, null, 2));
console.log('DIAG_DATA:', JSON.stringify(data));
