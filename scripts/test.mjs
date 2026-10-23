import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Node 20 on Windows does not expand shell wildcards.
const tests=fileURLToPath(new URL('../tests/',import.meta.url));
const files=readdirSync(tests).filter(name=>name.endsWith('.test.js')).sort().map(name=>fileURLToPath(new URL('../tests/'+name,import.meta.url)));
const result=spawnSync(process.execPath,['--test',...process.argv.slice(2),...files],{stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status ?? 1;
