/** Local-only preview of an explicitly marked disposable build. */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { withinRoot } from '../src/content-engine/operations/files.mjs';
const root=resolve(process.argv[2] ?? ''), port=Number(process.argv[3] ?? 4322);
if (!existsSync(join(root,'FIXTURE-INFO.json'))) throw new Error('This preview requires a FIXTURE-INFO.json marker from i18n:scale --out');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.json':'application/json','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8','.xml':'application/xml'};
createServer((req,res)=>{
  try {
    const route=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    let file=withinRoot(root,`.${route==='/'?'/index.html':route}`);
    if (existsSync(file)&&statSync(file).isDirectory()) file=join(file,'index.html');
    if (!existsSync(file)) {res.writeHead(404);res.end('Not found');return;}
    res.writeHead(200,{'Content-Type':mime[extname(file)] ?? 'application/octet-stream','Cache-Control':'no-store'});res.end(readFileSync(file));
  } catch {res.writeHead(400);res.end('Invalid path');}
}).listen(port,'127.0.0.1',()=>console.log(`INTERNAL fixture preview http://127.0.0.1:${port}/`));
