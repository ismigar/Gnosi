// @ts-check

const PREVIEW_TIMEOUT_MS = 15000;

/**
 * Aborting a protocol response body must also release its upstream HTTP slot.
 * Chromium's custom-protocol request signal can outlive a renderer reload.
 * @param {ReadableStream<Uint8Array>} body
 * @param {AbortController} controller
 * @param {() => void} cleanup
 */
function cancellableBody(body, controller, cleanup) {
  const reader = body.getReader();
  let cancelled = false;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    cleanup();
    reader.releaseLock();
  };
  return new ReadableStream({
    async pull(target) {
      try {
        const result = await reader.read();
        if (cancelled) return;
        if (result.done) {
          target.close();
          finish();
        } else target.enqueue(result.value);
      } catch (error) {
        if (!cancelled) {
          target.error(error);
          finish();
        }
      }
    },
    async cancel(reason) {
      cancelled = true;
      controller.abort(reason);
      try {
        await reader.cancel(reason);
      } catch {
        // Aborting fetch can already have errored its body.
      } finally {
        finish();
      }
    },
  });
}

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
  else request.signal.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  const timer = preview ? setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('Preview timed out', 'TimeoutError'));
  }, previewTimeoutMs) : undefined;
  const headers = new Headers(request.headers);
  for (const name of ['host', 'origin', 'referer', 'cookie', 'content-length']) headers.delete(name);
  const cleanup = () => {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', cancel);
  };
  let streaming = false;
  try {
    const upstream = await fetchBackend(backendUrl, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'follow',
      // @ts-expect-error Chromium requires duplex for streamed request bodies.
      duplex: 'half',
      signal: controller.signal,
    });
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete('transfer-encoding');
    // Previews are small JSON responses. Consume them while the deadline is
    // active, so a stalled response body cannot retain a connection either.
    const body = preview ? await upstream.arrayBuffer()
      : upstream.body ? cancellableBody(upstream.body, controller, cleanup) : null;
    const response = new Response(body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
    streaming = !preview && body !== null;
    return response;
  } catch (error) {
    controller.abort(error);
    if (!timedOut) throw error;
    return Response.json({ detail: 'Preview temporarily unavailable' }, { status: 504 });
  } finally {
    if (!streaming) cleanup();
  }
}

module.exports = { proxyBackendRequest, PREVIEW_TIMEOUT_MS };
