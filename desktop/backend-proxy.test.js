const assert = require('node:assert/strict');
const { test } = require('node:test');
const { proxyBackendRequest } = require('./backend-proxy');

const previewUrl = 'app://gnosi/api/v1/vaults/principal/knowledge/pages/page-1/preview?full=true';
const pendingFetch = (_url, { signal }) => new Promise((_, reject) => {
  if (signal.aborted) reject(signal.reason);
  else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
});

test('stalled cloud previews release all occupied request slots so a view can save', async () => {
  let occupied = 0;
  const fetchBackend = (url, init) => {
    if (url.endsWith('/views')) {
      assert.equal(occupied, 0);
      return Promise.resolve(Response.json({ ok: true }));
    }
    occupied += 1;
    return pendingFetch(url, init).finally(() => { occupied -= 1; });
  };
  const previews = Array.from({ length: 6 }, () => proxyBackendRequest(
    new Request(previewUrl), 'http://localhost/preview', fetchBackend, 20,
  ));
  assert.equal(occupied, 6);
  for (const response of await Promise.all(previews)) assert.equal(response.status, 504);
  const saved = await proxyBackendRequest(new Request('app://gnosi/api/vault/views', {
    method: 'POST', body: '{}',
  }), 'http://localhost/views', fetchBackend);
  assert.deepEqual(await saved.json(), { ok: true });
});

test('the preview deadline also covers a stalled JSON response body', async () => {
  const response = await proxyBackendRequest(new Request(previewUrl), 'http://localhost/preview',
    async (_url, { signal }) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{'));
        signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
      },
    })), 20);
  assert.equal(response.status, 504);
});

test('renderer cancellation reaches upstream for previews and writes', async () => {
  for (const url of [previewUrl, 'app://gnosi/api/vault/views']) {
    const controller = new AbortController();
    const pending = proxyBackendRequest(new Request(url, { signal: controller.signal }),
      'http://localhost/api', pendingFetch);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
  }
});

test('streams keep their lifetime, request body, and cookie handling', async () => {
  const controller = new AbortController();
  const request = new Request('app://gnosi/api/chat', { method: 'POST', body: '{"message":"hello"}',
    signal: controller.signal, headers: { cookie: 'private', origin: 'app://gnosi', 'content-type': 'application/json' } });
  let upstreamSignal;
  const response = await proxyBackendRequest(request, 'http://localhost/chat', async (_url, init) => {
    assert.equal(init.headers.has('cookie'), false);
    assert.equal(init.headers.has('origin'), false);
    assert.equal(init.headers.get('content-type'), 'application/json');
    assert.equal(await new Response(init.body).text(), '{"message":"hello"}');
    upstreamSignal = init.signal;
    return new Response('event: done\n\n', { headers: { 'content-type': 'text/event-stream' } });
  }, 1);
  assert.equal(upstreamSignal, request.signal);
  assert.equal(await response.text(), 'event: done\n\n');
  controller.abort();
  assert.equal(upstreamSignal.aborted, true);
});
