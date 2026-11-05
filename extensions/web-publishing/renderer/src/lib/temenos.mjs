import sanitizeHtml from 'sanitize-html';

const copy={
  ca:{tags:'Etiquetes',writtenBy:'Escrit per',currentSite:'Web actual',share:'Comparteix',email:'Correu electrònic',read:'Llegir article',original:'Text en',about:'Què és Temenos',me:'Coneix-me',newsletter:'Subscríu-te al butlletí',test:'Prova amb una adreça fictícia acabada en .invalid. No s’envia cap correu real.',consent:'Accepto la política de privacitat',consentStart:'Accepto la',privacy:'política de privacitat',subscribe:"Subscriure's",collaborators:'Col·laboren'},
  es:{tags:'Etiquetas',writtenBy:'Escrito por',currentSite:'Web actual',share:'Compartir',email:'Correo electrónico',read:'Leer artículo',original:'Texto en',about:'Qué es Temenos',me:'Conóceme',newsletter:'Subscríbete al boletín',test:'Prueba con una dirección ficticia terminada en .invalid. No se envían correos reales.',consent:'Acepto la política de privacidad',consentStart:'Acepto la',privacy:'política de privacidad',subscribe:'Suscribirse',collaborators:'Colaboran'},
  'en-gb':{tags:'Tags',writtenBy:'Written by',currentSite:'Current website',share:'Share',email:'Email',read:'Read article',original:'Text in',about:'What is Temenos',me:'About me',newsletter:'Subscribe to the newsletter',test:'Use a fictional address ending in .invalid. No real email is sent.',consent:'I accept the privacy policy',consentStart:'I accept the',privacy:'privacy policy',subscribe:'Subscribe',collaborators:'Collaborators'},
  fr:{tags:'Étiquettes',writtenBy:'Écrit par',currentSite:'Site actuel',share:'Partager',email:'Courriel',read:'Lire l’article',original:'Texte en',about:'Qu’est-ce que Temenos',me:'À propos de moi',newsletter:'S’abonner à la lettre',test:'Utilisez une adresse fictive se terminant par .invalid. Aucun courriel réel n’est envoyé.',consent:'J’accepte la politique de confidentialité',consentStart:'J’accepte la',privacy:'politique de confidentialité',subscribe:'S’abonner',collaborators:'Partenaires'},
};
export const temenosLabels=language=>copy[language] || copy['en-gb'];
export const plain=value=>sanitizeHtml(String(value||''),{allowedTags:[],allowedAttributes:{}}).replace(/\s+/g,' ').trim();
export const excerpt=record=>{const text=plain(record.presentation?.summary || record.body_html);return text.length>180?text.slice(0,180).trimEnd()+'…':text;};
export function publishedDate(record,language){
  const seconds=Number(record.presentation?.created);
  if(!Number.isFinite(seconds)||seconds<=0)return null;
  const date=new Date(seconds*1000);
  if(Number.isNaN(date.valueOf()))return null;
  const parts=new Intl.DateTimeFormat(language,{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Madrid'}).formatToParts(date);
  const part=type=>parts.find(value=>value.type===type)?.value || '';
  const short=`${part('day')} ${part('month').replace(/^de\s+/,'').replace(/\.$/,'')} ${part('year')}`;
  return {iso:date.toISOString(),short,text:date.toLocaleDateString(language,{year:'numeric',month:'long',day:'numeric',timeZone:'Europe/Madrid'})};
}

export function splitArticleImage(value){
  const body=String(value || '');
  const leading=body.match(/^\s*(<figure\b[^>]*>[\s\S]*?<\/figure>)([\s\S]*)$/i);
  return leading && /<img\b/i.test(leading[1]) ? {image:leading[1],body:leading[2]} : {image:'',body};
}
