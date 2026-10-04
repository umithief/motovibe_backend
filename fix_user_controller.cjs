const fs = require('fs');
const filePath = 'controllers/userController.js';
let content = fs.readFileSync(filePath, 'utf8');

// Find the second occurrence of "export const updateGarageItem" and remove it entirely.
// It is around line 1503.
const lines = content.split('\n');
const duplicateLine = lines.findIndex((line, i) => i > 1300 && line.includes('export const updateGarageItem'));
if (duplicateLine > -1) {
    let endLine = duplicateLine;
    while (!lines[endLine].startsWith('});')) {
        endLine++;
    }
    lines.splice(duplicateLine, endLine - duplicateLine + 1);
    fs.writeFileSync(filePath, lines.join('\n'));
    console.log(`Deleted lines ${duplicateLine} to ${endLine}`);
} else {
    console.log('Not found');
}
