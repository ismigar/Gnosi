import { describe, expect, it, vi } from 'vitest';
import { readNdjsonRecords, type NdjsonRecord } from './ndjson';

async function collect(response: Response, onMalformed = vi.fn()): Promise<NdjsonRecord[]> {
  const result: NdjsonRecord[] = [];
  for await (const record of readNdjsonRecords(response, { onMalformed })) result.push(record);
  return result;
}

function byteStream(text: string): Response {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  }));
}

describe('NDJSON response adapter', () => {
  it('preserves split multibyte characters and a final record without a newline', async () => {
    expect(await collect(byteStream('{"content":"Reunió àéç 🧠"}\n{"type":"done"}'))).toEqual([
      { content: 'Reunió àéç 🧠' }, { type: 'done' },
    ]);
  });

  it('skips blanks, accepts CRLF and isolates malformed records', async () => {
    const onMalformed = vi.fn();
    const response = byteStream('\r\n{"sequence":1}\r\ninvalid\nnull\n[]\n{"sequence":2}\n');
    expect(await collect(response, onMalformed)).toEqual([{ sequence: 1 }, { sequence: 2 }]);
    expect(onMalformed).toHaveBeenCalledTimes(3);
  });

  it('rejects a missing stream with a recoverable error', async () => {
    await expect(collect(new Response(null))).rejects.toThrow('Response stream is unavailable');
  });

  it('propagates read failures and releases the reader lock', async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.error(new Error('connection lost')); },
    }));
    await expect(collect(response)).rejects.toThrow('connection lost');
    expect(response.body?.locked).toBe(false);
  });

  it('cancels and releases the body when the consumer stops early', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"content":"first"}\n')); }, cancel,
    }));
    for await (const record of readNdjsonRecords(response)) {
      expect(record.content).toBe('first');
      break;
    }
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });

  it('releases the body after successful exhaustion', async () => {
    const response = byteStream('{"type":"done"}\n');
    await collect(response);
    expect(response.body?.locked).toBe(false);
  });
});
