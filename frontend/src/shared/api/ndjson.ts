export type NdjsonRecord = Record<string, unknown>;

export interface NdjsonReadOptions {
  readonly onMalformed?: (error: unknown) => void;
}

function parseRecord(line: string, options: NdjsonReadOptions): NdjsonRecord | null {
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new TypeError('Expected an NDJSON object');
    }
    return value as NdjsonRecord;
  } catch (error) {
    options.onMalformed?.(error);
    return null;
  }
}

/** Decode complete records, retaining both split UTF-8 bytes and partial lines. */
export async function* readNdjsonRecords(
  response: Response,
  options: NdjsonReadOptions = {},
): AsyncGenerator<NdjsonRecord, void, undefined> {
  if (!response.body) throw new Error('Response stream is unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let complete = false;
  try {
    while (!complete) {
      const chunk = await reader.read();
      complete = chunk.done;
      buffer += decoder.decode(chunk.value, { stream: !complete });
      const lines = buffer.split('\n');
      buffer = complete ? '' : lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const record = parseRecord(line, options);
        if (record) yield record;
      }
    }
  } finally {
    if (!complete) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
