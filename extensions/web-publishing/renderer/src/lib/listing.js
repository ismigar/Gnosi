export const listingLabels=lang=>({
  ca:{filter:'Filtra per tema',all:'Tots els temes',apply:'Filtra',page:'Pàgina',pagination:'Paginació',empty:'No hi ha resultats.',show:'Mostrar',actions:'Accions'},
  es:{filter:'Filtrar por tema',all:'Todos los temas',apply:'Filtrar',page:'Página',pagination:'Paginación',empty:'No hay resultados.',show:'Mostrar',actions:'Acciones'},
  fr:{filter:'Filtrer par thème',all:'Tous les thèmes',apply:'Filtrer',page:'Page',pagination:'Pagination',empty:'Aucun résultat.',show:'Afficher',actions:'Actions'},
  'en-gb':{filter:'Filter by topic',all:'All topics',apply:'Filter',page:'Page',pagination:'Pagination',empty:'No results.',show:'View',actions:'Actions'},
}[lang] || listingLabels('en-gb'));

export function listingState(items,search,pageSize,allowTags=true){
  const params=new URLSearchParams(search);
  const tag=allowTags ? params.get('tag') || '' : '';
  const filtered=items.filter(item=>!tag || item.tags.includes(tag));
  const size=Math.min(100,Math.max(1,Number(pageSize)||16));
  const count=Math.ceil(filtered.length/size);
  const page=Math.min(Math.max(1,Number.parseInt(params.get('page'),10)||1),count || 1);
  return {tag,page,count,total:filtered.length,visible:filtered.slice((page-1)*size,page*size)};
}
export function listingUrl(location,page,tag){
  const url=new URL(location.href);url.searchParams.delete('page');url.searchParams.delete('tag');
  if(page>1)url.searchParams.set('page',String(page));if(tag)url.searchParams.set('tag',tag);
  return url.pathname+url.search+url.hash;
}
