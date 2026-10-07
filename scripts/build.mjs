import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir, cp, rm} from 'node:fs/promises';
import {build} from 'esbuild';

// Keep PDF.js and binary fonts outside the Worker script. The Worker checks
// protected routes before delegating these files to the ASSETS binding.
await rm('dist', {recursive: true, force: true});
await mkdir('dist/public', {recursive: true});
await mkdir('dist/server', {recursive: true});
const names = ['index.html', 'app.js', 'auth.js', 'voice.js', 'builder-chat.js', 'styles.css', 'contextual-chat.css', 'blueprints.css', 'body.ttf', 'display.ttf', 'dmsans-OFL.txt', 'instrumentserif-OFL.txt'];
for (const name of names) await cp('web/' + name, 'dist/public/' + name);
for (const name of ['pdf.min.mjs', 'pdf.worker.min.mjs']) await cp('node_modules/pdfjs-dist/build/' + name, 'dist/public/' + name);

// A new page requests the CSS and JavaScript versions in its own build.
let page = await readFile('dist/public/index.html', 'utf8');
const versions = new Map();
for (const name of names.filter(name => /\.(?:css|js)$/.test(name))) versions.set('/' + name, createHash('sha256').update(await readFile('dist/public/' + name)).digest('hex').slice(0, 12));
page = page.replace(/(href|src)="(\/[^"?]+\.(?:css|js))"/g, (match, attr, path) => versions.has(path) ? `${attr}="${path}?v=${versions.get(path)}"` : match);
await writeFile('dist/public/index.html', page);
await build({entryPoints: ['worker/index.js'], outfile: 'dist/server/index.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', legalComments: 'eof'});
console.log('Built standalone Worker and static assets. D1 migrations remain in drizzle/.');
