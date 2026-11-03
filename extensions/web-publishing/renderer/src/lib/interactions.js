import {listingState,listingUrl} from './listing.js';
export function initForms() {
  for (const form of document.querySelectorAll('form[data-contact]')) {
    const key=form.elements.namedItem('_request_id');
    key.value=crypto.randomUUID();
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if (!form.reportValidity() || form.dataset.busy) return;
      const button=form.querySelector('button[type=submit]');
      const status=form.querySelector('[data-contact-status]');
      form.dataset.busy='1';button.disabled=true;status.textContent='';
      for(const field of form.querySelectorAll('[aria-invalid]')) field.removeAttribute('aria-invalid');
      try {
        const response=await fetch(form.action,{method:'POST',body:new FormData(form),headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});
        const result=await response.json();
        if (!response.ok || !result.received) {
          for(const id of Object.keys(result.fields || {})) {
            const field=form.elements.namedItem(`values[${id}]`);
            if(field instanceof HTMLElement) field.setAttribute('aria-invalid','true');
          }
          throw new Error(result.fields ? 'invalid' : 'failed');
        }
        status.textContent=result.message;
        form.reset();key.value=crypto.randomUUID();
        if(result.redirect_path && result.redirect_path.startsWith('/') && !result.redirect_path.startsWith('//')) {
          const base=new URL(form.action).pathname.replace(/\/api\/contact\.php$/,'');
          const destination=new URL(result.redirect_path,location.origin);
          if(destination.origin===location.origin && (!base || destination.pathname.startsWith(base+'/'))) location.assign(destination.href);
        }
      } catch(error) {
        status.textContent=error.message==='invalid'?form.dataset.invalid:form.dataset.failure;
        status.classList.add('form-error');
      } finally {delete form.dataset.busy;button.disabled=false;status.focus();}
    });
  }
}
export async function initSearch() {
  const target=document.querySelector('[data-search-base]');
  if(!target) return;
  try {
    const module=await import(/* @vite-ignore */ `${target.dataset.searchBase}pagefind.js`);
    await module.options({baseUrl:target.dataset.searchBase.replace(/pagefind\/$/,''),bundlePath:target.dataset.searchBase});
    const input=document.createElement('input');input.type='search';input.placeholder=target.dataset.searchPlaceholder;input.setAttribute('aria-label',input.placeholder);
    const results=document.createElement('div');results.setAttribute('aria-live','polite');
    target.append(input,results);
    let generation=0;
    const search=async()=>{
      const active=++generation;const response=await module.search(input.value);
      const data=await Promise.all(response.results.slice(0,30).map(item=>item.data()));
      if(active!==generation)return;
      results.replaceChildren();
      for(const item of data){const article=document.createElement('article');const link=document.createElement('a');link.href=item.url;link.textContent=item.meta.title || item.url;const excerpt=document.createElement('p');excerpt.textContent=item.excerpt.replace(/<[^>]*>/g,'');article.append(link,excerpt);results.append(article);}
    };
    let timer;input.addEventListener('input',()=>{initLanguageLinks(input.value);clearTimeout(timer);timer=setTimeout(()=>{void search();},180);});
    input.value=new URLSearchParams(location.search).get('keys') || '';if(input.value)await search();
  } catch {target.textContent=target.dataset.searchPlaceholder;}
}
export function initDisclosure(){
  for(const details of document.querySelectorAll('header details')) {
    details.addEventListener('toggle',()=>{if(details.open)details.querySelector('input')?.focus();});
    document.addEventListener('click',event=>{if(!details.contains(event.target))details.open=false;});
    details.addEventListener('keydown',event=>{if(event.key==='Escape'){details.open=false;details.querySelector('summary')?.focus();}});
  }
}

export function initLanguageLinks(terms=new URLSearchParams(location.search).get('keys')){
  if(!document.querySelector('[data-search-base]'))return;
  for(const link of document.querySelectorAll('a[data-search-language]')){
    const destination=new URL(link.href);if(terms)destination.searchParams.set('keys',terms);else destination.searchParams.delete('keys');link.href=destination.href;
  }
}

export function initCompactHeader() {
  const header = document.querySelector('.temenos-site .site-header');
  const tools = header?.querySelector('.header-tools');
  if (!tools) return;

  const measure = () => {
    const toolsBottom = tools.getBoundingClientRect().bottom - header.getBoundingClientRect().top;
    header.style.setProperty('--header-sticky-top', `${-Math.ceil(toolsBottom)}px`);
  };
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(header);
  observer.observe(tools);
}

export function initMenu(){
  const toggle=document.querySelector('[data-menu-toggle]');
  const navigation=document.querySelector('[data-site-navigation]');
  if(!toggle || !navigation)return;
  const desktop=matchMedia('(min-width: 761px)');
  let expanded=false;
  const render=()=>{toggle.setAttribute('aria-expanded',String(desktop.matches || expanded));navigation.hidden=!desktop.matches && !expanded;};
  toggle.addEventListener('click',()=>{expanded=!expanded;render();});
  navigation.addEventListener('keydown',event=>{if(event.key==='Escape' && !desktop.matches){expanded=false;render();toggle.focus();}});
  desktop.addEventListener('change',()=>{expanded=false;render();});
  render();
}

export function initListings(){
  for(const listing of document.querySelectorAll('[data-public-listing]')){
    const items=[...listing.querySelectorAll('[data-listing-item]')].map(element=>({element,tags:JSON.parse(element.dataset.tags || '[]')}));
    const filter=listing.querySelector('[data-listing-filter]');
    const select=filter?.querySelector('select');
    const pagination=listing.querySelector('[data-listing-pagination]');
    const status=listing.querySelector('[data-listing-status]');
    const render=()=>{
      const state=listingState(items,location.search,listing.dataset.pageSize,Boolean(select));
      if(select)select.value=state.tag;
      const visible=new Set(state.visible);for(const item of items)item.element.hidden=!visible.has(item);
      status.textContent=state.total ? `${listing.dataset.pageLabel} ${state.page} / ${state.count}` : listing.dataset.emptyLabel;
      pagination.replaceChildren();
      if(state.count>1){
        // Bound the number of controls on large public collections.
        const numbers=new Set([1,state.count,state.page-1,state.page,state.page+1].filter(number=>number>=1 && number<=state.count));
        for(const number of [...numbers].sort((a,b)=>a-b)){
          const link=document.createElement('a');link.href=listingUrl(location,number,state.tag);link.textContent=String(number);link.setAttribute('aria-label',`${listing.dataset.pageLabel} ${number}`);
          if(number===state.page)link.setAttribute('aria-current','page');
          link.addEventListener('click',event=>{if(event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)return;event.preventDefault();history.pushState(null,'',link.href);render();status.focus();});
          pagination.append(link);
        }
      }
    };
    status.tabIndex=-1;
    filter?.addEventListener('submit',event=>{event.preventDefault();history.pushState(null,'',listingUrl(location,1,select.value));render();});
    select?.addEventListener('change',()=>{history.pushState(null,'',listingUrl(location,1,select.value));render();});
    addEventListener('popstate',render);render();
  }
}
