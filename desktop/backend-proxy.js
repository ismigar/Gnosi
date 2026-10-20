// @ts-check

const PREVIEW_TIMEOUT_MS = 15000;

/**
 * A cloud-backed preview must not occupy the desktop's HTTP connections
 * indefinitely and queue page/view writes behind it. Bound both headers and
 * body, and propagate renderer cancellation to the upstream request.
 * Other API responses (including agent streams) keep their normal lifetime.
 * @param {Request} request
 * @param {string} backendUrl
 * @param {typeof fetch} fetchBackend
 * @param {number} [previewTimeoutMs]
 * @returns {Promise<Response>}
 */
async function proxyBackendRequest(request, backendUrl, fetchBackend, previewTimeoutMs = PREVIEW_TIMEOUT_MS) {
  const preview = request.method === 'GET'
    && /\/pages\/[^/]+\/preview$/.test(new URL(request.url).pathname);
  const controller = new AbortController();
  const cancel = () => controller.abort(request.signal.reason);
  if (request.signal.aborted) cancel();
  else if (preview) request.signal.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  const timer = preview ? setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('Preview timed out', 'TimeoutError'));
  }, previewTimeoutMs) : undefined;
  const headers = new Headers(request.headers);
  for (const name of ['host', 'origin', 'referer', 'cookie', 'content-length']) headers.delete(name);
  try {
    const upstream = await fetchBackend(backendUrl, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'follow',
      // @ts-expect-error Chromium requires duplex for streamed request bodies.
      duplex: 'half',
      signal: preview ? controller.signal : request.signal,
    });
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete('transfer-encoding');
    // Previews are small JSON responses. Consume them while the deadline is
    // active, so a stalled response body cannot retain a connection either.
    const body = preview ? await upstream.arrayBuffer() : upstream.body;
    return new Response(body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    if (!timedOut) throw error;
    return Response.json({ detail: 'Preview temporarily unavailable' }, { status: 504 });
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', cancel);
  }
}

module.exports = { proxyBackendRequest, PREVIEW_TIMEOUT_MS };
