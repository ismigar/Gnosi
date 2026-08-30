import { logError } from '../../../shared/notifications/notifyError';
import { transportFetch } from '../../../shared/api/transports';
import {
  isUnknownArray,
  isUnknownRecord,
  pdfAnnotationToZotero,
  zoteroToPdfAnnotation,
  type AnnotationIdUpdate,
  type ZoteroAnnotation,
} from './zoteroReaderModel';

export interface MutableValue<T> {
  current: T;
}

export interface AnnotationPersistenceState {
  readonly annotations: MutableValue<ZoteroAnnotation[]>;
  readonly idMap: MutableValue<Map<string, number>>;
}

export type PostReaderMessage = (message: Readonly<Record<string, unknown>>) => void;

function errorWithResponse(
  operation: string,
  status: number,
  detail: string,
): Error {
  const suffix = detail ? `: ${detail.slice(0, 200)}` : '';
  return new Error(`${operation} failed with HTTP ${String(status)}${suffix}`);
}

async function responseDetail(response: Response): Promise<string> {
  return response.text().catch(() => '');
}

export async function fetchPersistedAnnotations(
  rawSrc: string,
  signal: AbortSignal | undefined,
  state: AnnotationPersistenceState,
): Promise<ZoteroAnnotation[] | null> {
  if (!rawSrc) return [];
  const response = await transportFetch(
    `/api/vault/pdf-annotations?source_uri=${encodeURIComponent(rawSrc)}`,
    { signal },
  );
  if (signal?.aborted || !response.ok) return null;
  const data: unknown = await response.json();
  if (signal?.aborted) return null;
  if (!isUnknownArray(data)) return [];
  const mapped = data.map(pdfAnnotationToZotero);
  state.annotations.current = mapped;
  for (const annotation of mapped) {
    if (typeof annotation.id === 'string' && annotation.id.startsWith('gnosi:')) {
      state.idMap.current.set(annotation.id, Number(annotation.id.slice(6)));
    }
  }
  return mapped;
}

export async function persistSaveAnnotations(
  values: readonly unknown[],
  rawSrc: string,
  state: AnnotationPersistenceState,
  postToReader: PostReaderMessage,
): Promise<void> {
  const idUpdates: AnnotationIdUpdate[] = [];
  for (const value of values) {
    if (!isUnknownRecord(value)) continue;
    const annotation: ZoteroAnnotation = value;
    const annotationId = typeof annotation.id === 'string' ? annotation.id : null;
    let dbId: number | null = null;
    if (annotationId?.startsWith('gnosi:')) {
      dbId = Number(annotationId.slice('gnosi:'.length));
    } else if (annotationId && state.idMap.current.has(annotationId)) {
      dbId = state.idMap.current.get(annotationId) ?? null;
    }
    const body = zoteroToPdfAnnotation(annotation, rawSrc);
    try {
      if (dbId !== null) {
        const response = await transportFetch(`/api/vault/pdf-annotations/${String(dbId)}`, {
          body: JSON.stringify({
            color: body.color,
            comment: body.comment,
            rects: body.rects,
            text: body.text,
          }),
          headers: { 'Content-Type': 'application/json' },
          method: 'PATCH',
        });
        if (!response.ok) {
          logError(
            'zotero-reader.patch-annotation',
            errorWithResponse('PATCH annotation', response.status, await responseDetail(response)),
          );
        }
        continue;
      }
      const response = await transportFetch('/api/vault/pdf-annotations', {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (!response.ok) continue;
      const created: unknown = await response.json();
      const createdId = isUnknownRecord(created) ? created.id : undefined;
      if (
        !annotationId
        || (typeof createdId !== 'number' && typeof createdId !== 'string')
      ) continue;
      const numericId = Number(createdId);
      const newId = `gnosi:${String(createdId)}`;
      state.idMap.current.set(annotationId, numericId);
      state.idMap.current.set(newId, numericId);
      idUpdates.push({ newId, oldId: annotationId });
    } catch (error) {
      logError('zotero-reader.persist-save', error);
    }
  }
  if (idUpdates.length > 0) {
    postToReader({
      idMap: idUpdates,
      target: 'zotero-reader',
      type: 'update-annotation-ids',
    });
  }
}

export async function persistDeleteAnnotations(
  values: readonly unknown[],
  state: AnnotationPersistenceState,
): Promise<void> {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    let dbId: number | null = null;
    if (value.startsWith('gnosi:')) {
      dbId = Number(value.slice('gnosi:'.length));
    } else if (state.idMap.current.has(value)) {
      dbId = state.idMap.current.get(value) ?? null;
    }
    if (dbId === null) continue;
    try {
      const response = await transportFetch(
        `/api/vault/pdf-annotations/${String(dbId)}`,
        { method: 'DELETE' },
      );
      if (response.ok || response.status === 404) {
        state.idMap.current.delete(value);
        state.idMap.current.delete(`gnosi:${String(dbId)}`);
      } else {
        logError(
          'zotero-reader.delete-annotation',
          errorWithResponse('DELETE annotation', response.status, await responseDetail(response)),
        );
      }
    } catch (error) {
      logError('zotero-reader.delete-annotation', error);
    }
  }
}
