import sanitizeHtml from 'sanitize-html';

const copy={
  ca:{currentSite:'Web actual',share:'Comparteix',email:'Correu electrònic',read:'Llegir article',original:'Text en',about:'Què és Temenos',me:'Coneix-me',newsletter:'Subscriu-te al butlletí',test:'Prova amb una adreça fictícia acabada en .invalid. No s’envia cap correu real.',testEmail:'Correu de prova',consent:'Accepto registrar aquesta subscripció de prova i el seu idioma.',subscribe:'Prova la subscripció',collaborators:'Col·laboren'},
  es:{currentSite:'Web actual',share:'Compartir',email:'Correo electrónico',read:'Leer artículo',original:'Texto en',about:'Qué es Temenos',me:'Conóceme',newsletter:'Suscríbete al boletín',test:'Prueba con una dirección ficticia terminada en .invalid. No se envían correos reales.',testEmail:'Correo de prueba',consent:'Acepto registrar esta suscripción de prueba y su idioma.',subscribe:'Prueba la suscripción',collaborators:'Colaboran'},
  'en-gb':{currentSite:'Current website',share:'Share',email:'Email',read:'Read article',original:'Text in',about:'What is Temenos',me:'About me',newsletter:'Subscribe to the newsletter',test:'Use a fictional address ending in .invalid. No real email is sent.',testEmail:'Test email',consent:'I consent to recording this test subscription and its language.',subscribe:'Test subscription',collaborators:'Collaborators'},
  fr:{currentSite:'Site actuel',share:'Partager',email:'Courriel',read:'Lire l’article',original:'Texte en',about:'Qu’est-ce que Temenos',me:'À propos de moi',newsletter:'S’abonner à la lettre',test:'Utilisez une adresse fictive se terminant par .invalid. Aucun courriel réel n’est envoyé.',testEmail:'Courriel de test',consent:'J’accepte l’enregistrement de cet abonnement de test et de sa langue.',subscribe:'Tester l’abonnement',collaborators:'Partenaires'},
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
