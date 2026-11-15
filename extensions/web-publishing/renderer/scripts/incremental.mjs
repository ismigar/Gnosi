// Dependency keys describe rendered HTML, never replace the complete site model.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {bundle,site,pages,records,base,production,selection,href,html} from '../src/lib/site.mjs';
import {landingPath} from '../src/lib/routing.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const blocks=values=>(values||[]).flatMap(block=>[block,...blocks(block.children)]);
const chrome=[...(site.footer_columns||[]).flatMap(column=>column.blocks||[]),...(site.footer_blocks||[]),...(site.regions||[]).flatMap(region=>region.blocks||[])];
const {pages:configuredPages,revision,updated_at,created_at,...configuration}=site;
const shared={configuration,base,production,stylesheet:bundle.stylesheet_path};
// Route membership affects same-origin links and withdrawn HTML anchors. Hash
// the existing rendering helpers' outputs, rather than the entire route table.
function links(value){
  if(typeof value==='string')return [href(value),html(value)];
  if(Array.isArray(value))return value.map(links);
  if(value && typeof value==='object')return Object.values(value).map(links);
  return null;
}
function routeDependencies(page){
  const alternatives=pages.filter(other=>other.id===page.id || (page.translation_id && other.translation_id===page.translation_id)).map(other=>({language:other.language,path:other.path}));
  const landing=site.languages.map(language=>landingPath(pages,language));
  const visible=page.template==='map'?pages.filter(other=>other.language===page.language && !['search','map'].includes(other.template)).map(other=>({path:other.path,title:other.title})):[];
  const tags=site.legacy_pilot?(page.presentation?.tags||[]).map(tag=>pages.find(other=>other.id===`tag-${tag.tid}-${page.language}`)?.path):[];
  const hero=site.legacy_pilot && page.template==='home' && page.blocks.find(block=>block.type==='split');
  const heroLinks=hero && hero.actions==null?[2656,5].map(nid=>records.find(record=>record.language===page.language && Number(record.presentation?.nid)===nid)?.path):[];
  return {alternatives,landing,visible,tags,heroLinks};
}
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
    // Position controls collection ordering, but is not rendered by an article.
    const {source_order,...content}=page;
    const consumers=[page,...dependencies.flat()];
    const labels=consumers.map(record=>Object.keys(record.fields||{}).map(key=>record.field_labels?.[key] || selected.find(item=>item.field_labels?.[key])?.field_labels[key] || key));
    return [page.path,hash({shared,page:content,labels,dependencies,routes:routeDependencies(page),links:links([configuration,page,dependencies])})];
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
