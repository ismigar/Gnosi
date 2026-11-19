import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {bundle,site,production,pages,records,prefix,base,deployment,html,selection} from '../src/lib/site.mjs';

import {plan,restore} from './incremental.mjs';
import {isTagPage,tagFeedAlias} from '../src/lib/routing.mjs';
const incremental=plan();
const output=path.resolve('dist');
function run(command,args){const result=spawnSync(command,args,{stdio:'inherit'});if(result.status!==0)throw new Error('Website build failed');}
if(incremental.changed.length)run(process.execPath,['node_modules/astro/bin/astro.mjs','build']);
else fs.cpSync('public',output,{recursive:true});
restore(incremental);
const escape=value=>String(value??'').replace(/[<>&"']/g,char=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[char]));
const canonical=value=>new URL(prefix(value),deployment.origin).href;
function file(relative,content){const target=path.join(output,relative.replace(/^\//,''));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);}
function feed(language,selected,title=site.name){
  const items=selected.map(record=>{
    const guid=record.feed_guid || (site.legacy_pilot?'':site.id+':')+record.id+':'+record.language;
    const seconds=Number(record.presentation?.created);const date=new Date(seconds*1000);
    const published=Number.isFinite(seconds)&&seconds>0&&!Number.isNaN(date.valueOf())?`<pubDate>${date.toUTCString()}</pubDate>`:'';
    return `<item><title>${escape(record.title)}</title><link>${escape(canonical(record.path))}</link><guid isPermaLink="false">${escape(guid)}</guid>${published}<description>${escape(html(record.body_html))}</description></item>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escape(title)}</title><link>${escape(canonical('/'+language))}</link><description>${escape(site.name)}</description><language>${language}</language>${items}</channel></rss>`;
}
const editorialArticles=site.pages.filter(page=>page.enabled && page.template==='article' && !page.imported_record_id).map(page=>({...page,feed_guid:site.id+':page:'+page.id+':'+page.language,body_html:(page.blocks || []).flatMap(block=>[block,...(block.children || [])]).map(block=>block.body_html || '').join('\n')}));
for(const language of site.languages){
  const selected=[...records.filter(record=>record.language===language && (!site.legacy_pilot || !record.presentation?.kind || ['article','recurs','disseny'].includes(record.presentation.kind))),...editorialArticles.filter(page=>page.language===language)];
  if(site.legacy_pilot)selected.sort((a,b)=>Number(b.presentation?.created||0)-Number(a.presentation?.created||0));
  file(`/${language}/rss.xml`,feed(language,selected));
  for(const source of site.sources.filter(source=>source.enabled)){
    const scoped=selection({source_id:source.id,limit:100000},language);
    const content=feed(language,scoped,site.name+' · '+(source.title||site.name));
    file(`/${language}${source.path_prefix}.xml`,content);
    if(site.legacy_pilot && language===site.default_language && ['imported:blog','imported:research','imported:stories','imported:design'].includes(source.source_id))file(source.path_prefix+'.xml',content);
  }
}
file('/rss.xml',fs.readFileSync(path.join(output,site.default_language,'rss.xml'),'utf8'));
if(site.legacy_pilot){
  const defaults=new Map();
  for(const page of site.pages.filter(page=>page.enabled && isTagPage(page))){
    const block=page.blocks.find(block=>block.type==='selected');
    const content=feed(page.language,block?selection(block,page.language):[],site.name+' · '+page.title);
    file(page.path+'/feed',content);
    const alias=tagFeedAlias(page);
    if(alias && !Object.hasOwn(bundle.feed_aliases || {},alias) && (!defaults.has(alias)||page.language===site.default_language))defaults.set(alias,content);
  }
  for(const [alias,content] of defaults)file(alias,content);
}
for(const [origin,destination] of Object.entries(bundle.feed_aliases||{})){
  const content=fs.readFileSync(path.join(output,destination.slice(1)),'utf8');
  const target=path.join(output,origin.slice(1));
  if(fs.existsSync(target)&&fs.readFileSync(target,'utf8')!==content)throw new Error('Feed alias conflicts with a generated public file');
  file(origin,content);
}
file('/sitemap.xml',`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.filter(page=>page.template!=='search').map(page=>`<url><loc>${escape(canonical(page.path))}</loc></url>`).join('')}</urlset>`);
file('/robots.txt',production ? `User-agent: *\nAllow: /\nSitemap: ${canonical('/sitemap.xml')}\n` : 'User-agent: *\nDisallow: /\n');
const redirects={...site.redirects};
if(!pages.some(page=>page.path==='/'))redirects['/']='/'+site.default_language;
const rewrites=['AddDefaultCharset UTF-8','Options -Indexes -MultiViews','DirectorySlash Off','DirectoryIndex index.html','<IfModule mod_headers.c>',...(production ? [] : ['Header always set X-Robots-Tag "noindex, nofollow"']),'Header always set X-Content-Type-Options "nosniff"','</IfModule>','AddType application/wasm .wasm','<FilesMatch "^feed$">','ForceType application/rss+xml','</FilesMatch>','RewriteEngine On'];
if(base)rewrites.push(`RewriteBase ${base}/`);
const routeFile=value=>value==='/'?'index.html':value.replace(/^\//,'')+'/index.html';
for(const [from,to] of Object.entries(redirects)){
  if(!pages.some(page=>page.path===to))throw new Error('A redirect must point to a published page');
  if(pages.some(page=>page.path===from))throw new Error('A redirect conflicts with a published page');
  const destination=escape(prefix(to));
  file(routeFile(from),`<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta http-equiv="refresh" content="0;url=${destination}"></head><body data-pagefind-ignore><a href="${destination}">${escape(site.name)}</a></body></html>`);
  const escaped=from.slice(1).replace(/[.*+?^${}()|[\]\\\s#]/g,'\\$&');
  rewrites.push(`RewriteRule ^${escaped}/?$ ${prefix(to)} [R=301,L,NE]`);
}
for(const withdrawn of bundle.withdrawn_paths || []){
  if(pages.some(page=>page.path===withdrawn))continue;
  rewrites.push(`RewriteRule ^${withdrawn.slice(1).replace(/[.*+?^${}()|[\]\\\s#]/g,'\\$&')}/?$ - [G,L]`);
}
for(const page of pages){if(page.path==='/')continue;const relative=page.path.slice(1);const escaped=relative.replace(/[.*+?^${}()|[\]\\\s#]/g,'\\$&');rewrites.push(`RewriteRule ^${escaped}/?$ ${encodeURI(relative)}/index.html [END]`);}
file('/.htaccess',rewrites.join('\n')+'\n');
if(!incremental.same)run(process.execPath,['node_modules/pagefind/lib/runner/bin.cjs','--site','dist']);
console.log(JSON.stringify({incremental:{rendered:incremental.changed.length,reused:incremental.reused.length,search_rebuilt:!incremental.same}}));
// The renderer's build-time snapshot is private and is never copied into dist.
if(fs.existsSync(path.join(output,'bundle.json')))throw new Error('Private snapshot leaked into website output');
