import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] || path.join(root, 'dist-release'));
if (output === root || root.startsWith(output + path.sep)) throw new Error('Unsafe release destination');
try { await fs.access(output); throw new Error('Release destination already exists'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const archive = output + '.tar.gz';
try { await fs.access(archive); throw new Error('Release archive already exists'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const included = new Set();
const visit = async relative => {
    const source = path.resolve(root, relative);
    if (!source.startsWith(root + path.sep)) throw new Error('Import escapes source tree');
    if (included.has(relative)) return;
    const text = await fs.readFile(source, 'utf8');
    included.add(relative);
    for (const match of text.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
        await visit(path.relative(root, path.resolve(path.dirname(source), match[1])));
    }
};
await visit('server.js');
try { await visit('index.js'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
for (const filename of ['package.json','package-lock.json','firebase.json','ecosystem.config.cjs']) {
    try { await fs.access(path.join(root, filename)); included.add(filename); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
}
for (const relative of included) {
    if (/serviceAccount|\.env|\.tar|archive|^node_modules[\/]|^uploads[\/]/i.test(relative)) throw new Error('Private or archived file in release');
    const destination = path.join(output, relative);
    await fs.mkdir(path.dirname(destination), {recursive:true});
    await fs.copyFile(path.join(root, relative), destination);
}
await fs.writeFile(path.join(output, 'release-manifest.json'), JSON.stringify([...included].sort(), null, 2));
const packed = spawnSync('tar', ['-czf', archive, '-C', output, '.'], {encoding:'utf8'});
if (packed.error || packed.status !== 0) throw new Error('Release archive could not be created');
console.log(JSON.stringify({files:included.size, output, archive}));
