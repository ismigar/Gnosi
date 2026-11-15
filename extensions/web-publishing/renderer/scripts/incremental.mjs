// Dependency keys describe rendered HTML, never replace the complete site model.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {bundle,site,pages,records,base,production,selection} from '../src/lib/site.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const blocks=values=>(values||[]).flatMap(block=>[block,...blocks(block.children)]);
const chrome=[...(site.footer_columns||[]).flatMap(column=>column.blocks||[]),...(site.footer_blocks||[]),...(site.regions||[]).flatMap(region=>region.blocks||[])];
const {pages:configuredPages,revision,updated_at,created_at,...configuration}=site;
const routes=pages.map(page=>({id:page.id,translation_id:page.translation_id,language:page.language,path:page.path,template:page.template,title:page.title,nid:page.presentation?.nid}));
const shared={configuration,routes,base,production,stylesheet:bundle.stylesheet_path,withdrawn:bundle.withdrawn_paths||[]};
export function routeFile(route){
  if(typeof route!=='string'||!route.startsWith('/')||/[\\?#\u0000-\u001f]/.test(route)||route.split('/').some(part=>part==='.'||part==='..')||/%(?:2e|2f|5c)/i.test(route))throw new Error('Invalid incremental route');
  return route==='/'?'index.html':route.slice(1)+'/index.html';
}
export function routeKeys(){
  return Object.fromEntries(pages.map(page=>{
    routeFile(page.path);
    const source=site.sources.find(source=>source.id===page.source_id||(page.template==='listing'&&page.path===`/${page.language}${source.path_prefix}`));
    const selected=source?selection({source_id:source.id,limit:10000},page.language):records.filter(record=>record.language===page.language);
    const dependencies=blocks([...(page.blocks||[]),...chrome]).filter(block=>['selected','collection','collaborators'].includes(block.type)).map(block=>selection(block,page.language));
    if(['home','listing'].includes(page.template)&&!(page.blocks||[]).length)dependencies.push(selected);
    return [page.path,hash({shared,page,labels:selected.map(record=>record.field_labels),dependencies})];
  }));
}
export function plan(){
  const routes=routeKeys();
  let prior={routes:{}};
  if(fs.existsSync('prior-index.json'))prior=JSON.parse(fs.readFileSync('prior-index.json','utf8'));
  const reused=Object.keys(routes).filter(route=>routes[route]===prior.routes?.[route]&&fs.existsSync(path.join('prior',routeFile(route))));
  const changed=Object.keys(routes).filter(route=>!reused.includes(route));
  const same=changed.length===0&&Object.keys(prior.routes||{}).length===Object.keys(routes).length;
  fs.writeFileSync('render-paths.json',JSON.stringify(changed));
  fs.writeFileSync('render-index.json',JSON.stringify({routes}));
  return {routes,reused,changed,same};
}
function copy(source,target){
  if(fs.existsSync(target)){
    if(!fs.readFileSync(source).equals(fs.readFileSync(target)))throw new Error('Changed incremental generated asset');
    return;
  }
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);
}
function tree(source,target){
  if(!fs.existsSync(source))return;
  for(const entry of fs.readdirSync(source,{withFileTypes:true})){
    if(entry.isSymbolicLink())throw new Error('Invalid incremental cache link');
    if(entry.isDirectory())tree(path.join(source,entry.name),path.join(target,entry.name));
    else if(entry.isFile())copy(path.join(source,entry.name),path.join(target,entry.name));
    else throw new Error('Invalid incremental cache file');
  }
}
export function restore(plan){
  for(const route of plan.reused)copy(path.join('prior',routeFile(route)),path.join('dist',routeFile(route)));
  if(plan.reused.length)tree('prior/_astro','dist/_astro');
  if(plan.same)tree('prior/pagefind','dist/pagefind');
}
