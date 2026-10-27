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
