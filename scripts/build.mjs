import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,cp,rm} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});await mkdir('dist/server',{recursive:true});await mkdir('dist/.openai',{recursive:true});
const names=['index.html','app.js','voice.js','builder-chat.js','styles.css','contextual-chat.css','blueprints.css'];const assets={};
for(const name of names)assets['/'+(name==='index.html'?'':name)]={body:await readFile('web/'+name,'utf8'),type:name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'text/html'};
for(const name of ['body.ttf','display.ttf'])assets['/'+name]={body:(await readFile('web/'+name)).toString('base64'),type:'font/ttf',base64:true};
for(const name of ['pdf.min.mjs','pdf.worker.min.mjs'])assets['/'+name]={body:await readFile('node_modules/pdfjs-dist/build/'+name,'utf8'),type:'text/javascript'};
// Content-version assets so a new page never loads stale CSS or JavaScript.
assets['/'].body=assets['/'].body.replace(/(href|src)="(\/[^"]+\.(?:css|js))"/g,(match,attr,path)=>{const asset=assets[path];if(!asset)return match;const hash=createHash('sha256').update(asset.body).digest('hex').slice(0,12);return `${attr}="${path}?v=${hash}"`;});
const src=(await readFile('worker/index.js','utf8')).replace('__ASSET_BUNDLE__',JSON.stringify(assets));await writeFile('dist/server/index.js',src);
await cp('.openai/hosting.json','dist/.openai/hosting.json');await cp('drizzle','dist/.openai/drizzle',{recursive:true});
console.log('Built blueprint library with D1 migrations.');
