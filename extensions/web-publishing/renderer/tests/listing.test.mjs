import {test} from 'node:test';
import assert from 'node:assert/strict';
import {listingState,listingUrl} from '../src/lib/listing.js';
test('public listing filters before pagination and clamps stale deep links',()=>{
  const records=[{id:'a',tags:['9']},{id:'b',tags:['10']},{id:'c',tags:['9']},{id:'d',tags:['9']}];
  assert.deepEqual(listingState(records,'?tag=9&page=2',2).visible.map(item=>item.id),['d']);
  const stale=listingState(records,'?tag=9&page=999',2);assert.equal(stale.page,2);assert.equal(stale.count,2);
  assert.equal(listingState(records,'?tag=unknown',2).total,0);
  assert.equal(listingState(records,'?tag=9',2,false).total,4);
  assert.equal(listingState(records,'?page=-3',2).page,1);
});
test('pagination links preserve deployment path and unrelated query state',()=>{
  const location={href:'https://example.invalid/_gnosi/proof/current/ca/blog?tag=9&page=8&other=keep#listing'};
  assert.equal(listingUrl(location,2,'10'),'/_gnosi/proof/current/ca/blog?other=keep&page=2&tag=10#listing');
  assert.equal(listingUrl(location,1,''),'/_gnosi/proof/current/ca/blog?other=keep#listing');
});
