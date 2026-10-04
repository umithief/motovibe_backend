const fs = require('fs');
const filePath = 'controllers/userController.js';
let content = fs.readFileSync(filePath, 'utf8');

let lines = content.split('\n');

function removeSecondOccurrence(pattern) {
    let count = 0;
    let startLine = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i] !== null && lines[i].includes(pattern)) {
            count++;
            if (count === 2) {
                startLine = i;
                break;
            }
        }
    }
    
    if (startLine > -1) {
        let endLine = startLine;
        while (endLine < lines.length && !lines[endLine].startsWith('});')) {
            endLine++;
        }
        console.log(`Removing ${pattern} (2nd occurrence) from ${startLine + 1} to ${endLine + 1}`);
        for (let i = startLine; i <= endLine; i++) {
            lines[i] = null; // Mark for deletion
        }
    } else {
        console.log(`Pattern not found twice: ${pattern}`);
    }
}

removeSecondOccurrence('export const verifyGarageItem');
removeSecondOccurrence('export const getBusinessCatalog');
// Using exact match to not match updateBusinessCatalogItem
removeSecondOccurrence('export const updateBusinessCatalog =');

lines = lines.filter(l => l !== null);
fs.writeFileSync(filePath, lines.join('\n'));
console.log('Fixed duplicates.');
