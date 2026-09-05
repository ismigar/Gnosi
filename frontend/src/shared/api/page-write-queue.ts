// Build each request only after the preceding response has updated its ETag.
// Rejections must remain visible to callers without blocking subsequent work.
const pendingWrites = new Map<string, Promise<unknown>>();

export function queuePageWrite<T>(pageId: string, write: () => Promise<T>): Promise<T> {
  const previous = pendingWrites.get(pageId) ?? Promise.resolve();
  const next = previous.then(write, write);
  pendingWrites.set(pageId, next);
  const clear = () => {
    if (pendingWrites.get(pageId) === next) pendingWrites.delete(pageId);
  };
  void next.then(clear, clear);
  return next;
}
