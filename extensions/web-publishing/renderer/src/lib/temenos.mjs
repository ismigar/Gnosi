import sanitizeHtml from 'sanitize-html';

const copy={
  ca:{currentSite:'Web actual',share:'Comparteix',email:'Correu electrònic',read:'Llegir article',original:'Text en',about:'Què és Temenos',me:'Coneix-me',newsletter:'Subscríu-te al butlletí',test:'Prova amb una adreça fictícia acabada en .invalid. No s’envia cap correu real.',consent:'Accepto la política de privacitat',subscribe:"Subscriure's",collaborators:'Col·laboren'},
  es:{currentSite:'Web actual',share:'Compartir',email:'Correo electrónico',read:'Leer artículo',original:'Texto en',about:'Qué es Temenos',me:'Conóceme',newsletter:'Subscríbete al boletín',test:'Prueba con una dirección ficticia terminada en .invalid. No se envían correos reales.',consent:'Accepto la política de privacidad',subscribe:'Suscribirse',collaborators:'Colaboran'},
  'en-gb':{currentSite:'Current website',share:'Share',email:'Email',read:'Read article',original:'Text in',about:'What is Temenos',me:'About me',newsletter:'Subscribe to the newsletter',test:'Use a fictional address ending in .invalid. No real email is sent.',consent:'I accept privacy policy',subscribe:'Subscribe',collaborators:'Collaborators'},
  fr:{currentSite:'Site actuel',share:'Partager',email:'Courriel',read:'Lire l’article',original:'Texte en',about:'Qu’est-ce que Temenos',me:'À propos de moi',newsletter:'S’abonner à la lettre',test:'Utilisez une adresse fictive se terminant par .invalid. Aucun courriel réel n’est envoyé.',consent:'J’accepte la politique de confidentialité',subscribe:'S’abonner',collaborators:'Partenaires'},
};
export const temenosLabels=language=>copy[language] || copy['en-gb'];
export const plain=value=>sanitizeHtml(String(value||''),{allowedTags:[],allowedAttributes:{}}).replace(/\s+/g,' ').trim();
export const excerpt=record=>{const text=plain(record.presentation?.summary || record.body_html);return text.length>180?text.slice(0,180).trimEnd()+'…':text;};
export function publishedDate(record,language){
  const seconds=Number(record.presentation?.created);
  if(!Number.isFinite(seconds)||seconds<=0)return null;
  const date=new Date(seconds*1000);
  if(Number.isNaN(date.valueOf()))return null;
  return {iso:date.toISOString(),text:date.toLocaleDateString(language,{year:'numeric',month:'long',day:'numeric',timeZone:'Europe/Madrid'})};
}
