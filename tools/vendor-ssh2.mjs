// node tools/vendor-ssh2.mjs — rebuilds src/main/vendor/ssh2.cjs from node_modules/ssh2 (a devDependency): one file, its
// optional native add-ons (cpu-features, sshcrypto) left out so it uses Node's own crypto, and safe in an ESM bundle
// (no bare __dirname). Systems and Home Lab's Check now uses it (src/main/life-records/system-probe.ts).
import { build } from 'rolldown';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'src/main/vendor/ssh2.cjs');
await build({ input: path.join(root, 'node_modules/ssh2/lib/index.js'), platform: 'node', external: ['cpu-features', /\.node$/, /^node:/], output: { file: out, format: 'cjs' }, logLevel: 'silent', cwd: root });
let t = readFileSync(out, 'utf8')
  .replace(/require\((["'])(cpu-features|[^"']*\.node)\1\)/g, '(() => { throw new Error("optional native add-on not included") })()')
  .replace(/__dirname \+ "\/"/g, '(typeof __dirname !== "undefined" ? __dirname : ".") + "/"')
  .replace(/resolve\(__dirname, /g, 'resolve(typeof __dirname !== "undefined" ? __dirname : ".", ');
const version = JSON.parse(readFileSync(path.join(root, 'node_modules/ssh2/package.json'), 'utf8')).version;
writeFileSync(out, `// ssh2 ${version} (MIT, github.com/mscdex/ssh2), bundled into one file by tools/vendor-ssh2.mjs for Systems and Home Lab's\n// Check now. Its optional native add-ons are left out, so it uses Node's own crypto.\n/* eslint-disable */\n${t}`);
console.log('ssh2', version, '→', path.relative(root, out));
