import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const zip = new JSZip();
const release = 'release-pg';
if (!fs.existsSync('.next/standalone/worker.cjs')) throw new Error('Run npm run build:standalone first');
if (!fs.existsSync('.next/linux-runtime/node_modules/@img/sharp-linux-x64')) {
  throw new Error('Install Linux sharp into .next/linux-runtime before packaging');
}
function add(dir, prefix) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (/win32/.test(entry.name) || entry.name === '.env' || entry.name.startsWith('.env.')) continue;
    const file = path.join(dir, entry.name);
    if (fs.statSync(file).isDirectory()) add(file, prefix + entry.name + '/');
    else zip.file(prefix + entry.name, fs.readFileSync(file), { unixPermissions: 0o100644 });
  }
}
add('.next/standalone', release + '/');
add('.next/linux-runtime/node_modules/@img', release + '/node_modules/@img/');
const envFile = process.env.CPANEL_ENV_FILE || (fs.existsSync('.env.production.local') ? '.env.production.local' : '.env');
zip.file(release + '/.env', fs.readFileSync(envFile), { unixPermissions: 0o100600 });
zip.file('app.cjs', `process.env.NODE_ENV = 'production';\nprocess.env.HOSTNAME = '127.0.0.1';\nrequire('./${release}/server.js');\n`, { unixPermissions: 0o100644 });
const output = '.next/dokitruyen-postgres.zip';
await new Promise((resolve, reject) => {
  zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE', platform: 'UNIX' })
    .pipe(fs.createWriteStream(output)).on('finish', resolve).on('error', reject);
});
console.log('cPanel package ready:', output, fs.statSync(output).size, 'bytes');
