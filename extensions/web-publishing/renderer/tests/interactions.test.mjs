import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initForms,initLanguageLinks} from '../src/lib/interactions.js';

function environment(t,values){
  for(const [name,value] of Object.entries(values)){
    const prior=Object.getOwnPropertyDescriptor(globalThis,name);
    Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
    t.after(()=>prior?Object.defineProperty(globalThis,name,prior):delete globalThis[name]);
  }
}
test('successful contact follows the server redirect once under a deployment prefix',async t=>{
  let submit;let destination;let resets=0;const key={value:''};
  const button={disabled:false};const status={textContent:'',classList:{add(){}},focus(){}};
  const form={elements:{namedItem:()=>key},dataset:{},action:'https://example.invalid/_gnosi-proves/webs/test/current/api/contact.php',
    addEventListener:(type,handler)=>{submit=handler;},reportValidity:()=>true,
    querySelector:selector=>selector.startsWith('button')?button:status,querySelectorAll:()=>[],reset:()=>{resets++;}};
  environment(t,{document:{querySelectorAll:()=>[form]},FormData:class{},location:{origin:'https://example.invalid',assign:value=>{destination=value;}},
    fetch:async()=>({ok:true,json:async()=>({received:true,message:'Received',redirect_path:'/_gnosi-proves/webs/test/current/ca/thanks'})})});
  initForms();await submit({preventDefault(){}});
  assert.equal(destination,'https://example.invalid/_gnosi-proves/webs/test/current/ca/thanks');
  assert.equal(resets,1);assert.equal(button.disabled,false);assert.equal(status.textContent,'Received');
});
test('recoverable contact failure keeps the entered draft and request identity',async t=>{
  let submit;let resets=0;const key={value:''};const button={disabled:false};const status={textContent:'',classList:{add(){}},focus(){}};
  const form={elements:{namedItem:()=>key},dataset:{failure:'Retry'},action:'https://example.invalid/api/contact.php',
    addEventListener:(type,handler)=>{submit=handler;},reportValidity:()=>true,
    querySelector:selector=>selector.startsWith('button')?button:status,querySelectorAll:()=>[],reset:()=>{resets++;}};
  environment(t,{document:{querySelectorAll:()=>[form]},FormData:class{},location:{origin:'https://example.invalid'},fetch:async()=>{throw new Error('Offline');}});
  initForms();const original=key.value;await submit({preventDefault(){}});
  assert.equal(resets,0);assert.equal(key.value,original);assert.equal(status.textContent,'Retry');assert.equal(button.disabled,false);
});
test('translated search navigation retains the query without changing its destination',t=>{
  const link={href:'https://example.invalid/proof/es/search/node'};
  environment(t,{location:{search:'?keys=vida%20compartida'},document:{querySelector:()=>({}),querySelectorAll:()=>[link]}});
  initLanguageLinks();assert.equal(link.href,'https://example.invalid/proof/es/search/node?keys=vida+compartida');
  initLanguageLinks('new query');assert.equal(link.href,'https://example.invalid/proof/es/search/node?keys=new+query');
  initLanguageLinks('');assert.equal(link.href,'https://example.invalid/proof/es/search/node');
});

test('mobile menu closes with Escape and resets when returning from desktop',async t=>{
  const {initMenu}=await import('../src/lib/interactions.js');
  const events={};let focused=false;const attrs={};const media={matches:false,addEventListener:(_,handler)=>events.resize=handler};
  const toggle={setAttribute:(name,value)=>attrs[name]=value,addEventListener:(_,handler)=>events.click=handler,focus:()=>focused=true};
  const navigation={hidden:false,addEventListener:(_,handler)=>events.keydown=handler};
  environment(t,{document:{querySelector:selector=>selector==='[data-menu-toggle]'?toggle:navigation},matchMedia:()=>media});
  initMenu();assert.equal(navigation.hidden,true);assert.equal(attrs['aria-expanded'],'false');
  events.click();assert.equal(navigation.hidden,false);assert.equal(attrs['aria-expanded'],'true');
  events.keydown({key:'Escape'});assert.equal(navigation.hidden,true);assert.equal(focused,true);
  media.matches=true;events.resize();assert.equal(navigation.hidden,false);assert.equal(attrs['aria-expanded'],'true');
  media.matches=false;events.resize();assert.equal(navigation.hidden,true);assert.equal(attrs['aria-expanded'],'false');
});

test('listing navigation restores filter and page on browser back without losing the prefix',async t=>{
  const {initListings}=await import('../src/lib/interactions.js');
  const events={};const links=[];
  const items=Array.from({length:5},(_,index)=>({dataset:{tags:JSON.stringify(index===1?['10']:['9'])},hidden:false}));
  const select={value:'',addEventListener:(type,handler)=>events[type]=handler};
  const filter={querySelector:()=>select,addEventListener:(type,handler)=>events[type]=handler};
  const status={textContent:'',focus(){}};
  const pagination={replaceChildren:()=>links.length=0,append:link=>links.push(link)};
  const listing={dataset:{pageSize:'2',pageLabel:'Pàgina',emptyLabel:'Empty'},querySelectorAll:()=>items,querySelector:selector=>({'[data-listing-filter]':filter,'[data-listing-status]':status,'[data-listing-pagination]':pagination})[selector]};
  const location={href:'https://example.invalid/proof/current/ca/blog?tag=9&page=2',search:'?tag=9&page=2'};
  const navigate=href=>{const url=new URL(href,location.href);location.href=url.href;location.search=url.search;};
  environment(t,{location,history:{pushState:(_,__,href)=>navigate(href)},addEventListener:(type,handler)=>events[type]=handler,document:{querySelectorAll:()=>[listing],createElement:()=>({attributes:{},setAttribute(name,value){this.attributes[name]=value;},addEventListener(type,handler){this[type]=handler;}})}});
  initListings();assert.deepEqual(items.map(item=>item.hidden),[true,true,true,false,false]);assert.equal(select.value,'9');assert.equal(status.textContent,'Pàgina 2 / 2');
  links[0].click({button:0,preventDefault(){}});assert.equal(location.href,'https://example.invalid/proof/current/ca/blog?tag=9');
  select.value='10';events.change();assert.equal(status.textContent,'Pàgina 1 / 1');assert.equal(items[1].hidden,false);
  navigate('/proof/current/ca/blog?tag=9&page=2');events.popstate();assert.equal(select.value,'9');assert.deepEqual(items.map(item=>item.hidden),[true,true,true,false,false]);
});
