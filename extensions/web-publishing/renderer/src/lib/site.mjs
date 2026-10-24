import fs from 'node:fs';
import sanitizeHtml from 'sanitize-html';
import postcss from 'postcss';

export const bundle = JSON.parse(fs.readFileSync('bundle.json', 'utf8'));
export const site = bundle.site;
export const records = bundle.records;
export const deployment = new URL(bundle.deployment_url || site.origin);
export const base = deployment.pathname.replace(/\/$/, '');
export const prefix = value => base + (String(value).startsWith('/') ? value : '/' + value);
export const translate = (values, lang, fallback = '') => values?.[lang] ?? values?.[site.default_language] ?? fallback;
export const labels = lang => ({
  ca: {search:'Cerca',searchHint:'Escriu què busques i prem Retorn',map:'Mapa del web',send:'Envia',newsletter:'Subscriu-me al butlletí',privacy:'Accepto el text de privacitat',retry:'No s’ha pogut enviar. Conservem el text perquè ho puguis tornar a provar.',required:'Revisa els camps indicats.',preview:'Versió de prova',skip:'Ves al contingut'},
  es: {search:'Buscar',searchHint:'Escribe qué buscas y pulsa Intro',map:'Mapa del sitio',send:'Enviar',newsletter:'Suscribirme al boletín',privacy:'Acepto el texto de privacidad',retry:'No se ha podido enviar. Conservamos el texto para que puedas intentarlo de nuevo.',required:'Revisa los campos indicados.',preview:'Versión de prueba',skip:'Ir al contenido'},
  'en-gb': {search:'Search',searchHint:'Type what you want to find and press Enter',map:'Sitemap',send:'Send',newsletter:'Subscribe to the newsletter',privacy:'I accept the privacy notice',retry:'Could not send. Your text is preserved so you can try again.',required:'Check the highlighted fields.',preview:'Preview version',skip:'Skip to content'},
  fr: {search:'Rechercher',searchHint:'Écrivez votre recherche et appuyez sur Entrée',map:'Plan du site',send:'Envoyer',newsletter:'Recevoir la newsletter',privacy:'J’accepte la notice de confidentialité',retry:'Envoi impossible. Votre texte est conservé pour réessayer.',required:'Vérifiez les champs indiqués.',preview:'Version de test',skip:'Aller au contenu'},
}[lang] || labels('en-gb'));

export function href(value) {
  const text = String(value || '');
  if (!text || /[\u0000-\u0020\\]/.test(text) || text.startsWith('//')) return '#';
  if (text.startsWith('#')) return text;
  if (text.startsWith('/')) return prefix(text);
  try {
    const parsed = new URL(text);
    if (!['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) return '#';
    if (parsed.origin === new URL(site.origin).origin) return prefix(parsed.pathname) + parsed.search + parsed.hash;
    return parsed.href;
  } catch { return '#'; }
}
export function linkProps(value) {
  const destination = href(value);
  return /^https?:/.test(destination) ? {target:'_blank', rel:'noopener noreferrer'} : {};
}
export function html(value) {
  return sanitizeHtml(String(value || ''), {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'figure', 'figcaption'],
    allowedAttributes: {...sanitizeHtml.defaults.allowedAttributes, '*':['id','class','lang'],img:['src','alt','width','height','loading']},
    allowedSchemes: ['https','http','mailto','tel'], allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attributes) => ({tagName, attribs:{...attributes,href:href(attributes.href),...linkProps(attributes.href)}}),
      img: (tagName, attributes) => ({tagName, attribs:{...attributes,src:href(attributes.src),alt:attributes.alt || '',loading:'lazy'}}),
    },
  });
}
export const pages = [
  ...site.pages.filter(page => page.enabled),
  ...records.map(record => ({...record,template:'article',blocks:[],description:''})),
];
for (const lang of site.languages) {
  if (!pages.some(page => page.path === `/${lang}`)) pages.push({id:`home-${lang}`,translation_id:"generated:home",language:lang,path:`/${lang}`,title:site.name,template:'home',blocks:[],description:''});
  pages.push({id:`map-${lang}`,translation_id:"generated:map",language:lang,path:`/${lang}/mapa-web`,title:labels(lang).map,template:'map',blocks:[],description:''});
  pages.push({id:`search-${lang}`,translation_id:"generated:search",language:lang,path:`/${lang}/search/node`,title:labels(lang).search,template:'search',blocks:[],description:''});
  for (const source of site.sources.filter(source => source.enabled)) {
    const path = `/${lang}${source.path_prefix}`;
    if (!pages.some(page => page.path === path)) pages.push({id:`collection-${source.id}-${lang}`,translation_id:`generated:collection:${source.id}`,language:lang,path,title:source.title || site.name,template:'listing',source_id:source.id,blocks:[],description:''});
  }
}
const used = new Set();
for (const page of pages) {
  if (used.has(page.path)) throw new Error('Duplicate website paths');
  used.add(page.path);
}
export function selection(block, lang) {
  const wanted = new Set(block.page_ids || []);
  const selected = records.filter(record => record.language === lang && (!block.source_id || record.source_ids.includes(block.source_id)) && (!wanted.size || wanted.has(record.id)));
  if(wanted.size) selected.sort((a,b)=>block.page_ids.indexOf(a.id)-block.page_ids.indexOf(b.id));
  else if(block.source_id) selected.sort((a,b)=>(a.source_order?.[block.source_id]??0)-(b.source_order?.[block.source_id]??0));
  return selected.slice(0,block.limit || 100);
}
export function css(source, anchor) {
  if (!source) return '';
  if (/[<>]|@import\b|expression\s*\(|javascript\s*:/i.test(source)) throw new Error('Unsafe website CSS');
  const root = postcss.parse(source);
  root.walkDecls(decl => {
    decl.value = decl.value.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_match,_quote,url) => {
      if (!url.startsWith('/') || url.startsWith('//') || /[\s'"()\\]/.test(url)) throw new Error('CSS resources must be local website assets');
      return `url("${prefix(url)}")`;
    });
  });
  root.walkRules(rule => {
    if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
    rule.selectors = rule.selectors.map(selector => selector.includes('&') ? selector.replaceAll('&',anchor) : /^(?:html|body|:root)(?:\b|$)/.test(selector) ? selector.replace(/^(?:html|body|:root)/,anchor) : `${anchor} ${selector}`);
  });
  return root.toString();
}
export function themeCss(page) {
  const tokens = Object.entries(site.theme.tokens).map(([key,value]) => {
    if (!/^[a-z][a-z0-9-]*$/.test(key) || /[;{}<>]|url\s*\(|@/i.test(value)) throw new Error('Invalid theme value');
    return `--${key}:${value}`;
  }).join(';');
  const anchor = '.site-root';
  const fonts = (site.theme.fonts || []).map(font=>{
    if (!/^[\w -]+$/.test(font.family) || !/^[0-9 ]+$/.test(font.weight)) throw new Error('Invalid local font');
    return `@font-face{font-family:"${font.family}";src:url("${href(font.src)}");font-weight:${font.weight};font-style:${font.style};font-display:swap}`;
  }).join('');
  const blockCss = (page.blocks || []).map(block => css(block.css,`[data-block-id="${block.id.replace(/[^a-zA-Z0-9_-]/g,'')}"]`)).join('\n');
  return `@layer base,theme,components,page,advanced;@layer theme{${fonts}:root{${tokens}}}@layer page{${css(page.css,`[data-page-id="${page.id.replace(/[^a-zA-Z0-9_-]/g,'')}"]`)}${blockCss}}@layer advanced{${css(site.theme.advanced_css,anchor)}}`;
}
