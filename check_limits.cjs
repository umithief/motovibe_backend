const fs = require('fs');
const path = require('path');

const dir = 'c:\\Users\\ishak\\Downloads\\motovibe_flutter_app\\backend\\controllers';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));

for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file), 'utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('.find(') && !lines[i].includes('findById')) {
            // Check next 15 lines for .limit(
            let hasLimit = false;
            let queryEnd = false;
            for (let j = i; j < Math.min(i + 15, lines.length); j++) {
                if (lines[j].includes('.limit(')) {
                    hasLimit = true;
                    break;
                }
                if (lines[j].includes('res.status') || (j > i && lines[j].includes('.find('))) {
                    break;
                }
            }
            if (!hasLimit) {
                console.log('[' + file + ':' + (i+1) + '] ' + lines[i].trim());
            }
        }
    }
}
