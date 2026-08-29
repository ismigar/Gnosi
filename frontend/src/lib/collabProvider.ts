/**
 * Minimal Yjs provider over Gnosi's existing collaboration WebSocket.
 */
import * as Y from 'yjs';
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
} from 'y-protocols/awareness';

import {
  openWebSocket,
  WEB_SOCKET_OPEN_STATE,
} from '../shared/api/specialized-transports';
import {
  USER_EMAIL_STORAGE_KEY,
  USER_ID_STORAGE_KEY,
} from '../shared/api/request-context';
import { readStorage } from '../shared/platform/browser-storage';
import { ensureBackendOrigin } from './electron';
import { canonicalizeVaultApiUrl } from './vaultRouting';


export interface CollaborationUser {
  readonly color: string;
  readonly name: string;
}


type CollaborationMessageType = 'yjs-awareness' | 'yjs-update';


interface CollaborationMessage {
  readonly data: string;
  readonly type: CollaborationMessageType;
}


interface AwarenessChange {
  readonly added: readonly number[];
  readonly removed: readonly number[];
  readonly updated: readonly number[];
}


function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}


function fromBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}


function parseMessage(value: unknown): CollaborationMessage | null {
  if (typeof value !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (
    parsed === null
    || typeof parsed !== 'object'
    || !('type' in parsed)
    || !('data' in parsed)
  ) return null;
  const { data, type } = parsed;
  if (
    typeof data !== 'string'
    || (type !== 'yjs-update' && type !== 'yjs-awareness')
  ) return null;
  return { data, type };
}


export async function buildCollaborationWebSocketUrl(
  pageId: string,
): Promise<string> {
  const backendOrigin = await ensureBackendOrigin();
  const protocol = backendOrigin
    ? (backendOrigin.startsWith('https') ? 'wss' : 'ws')
    : (globalThis.location.protocol === 'https:' ? 'wss' : 'ws');
  const host = backendOrigin
    ? backendOrigin.replace(/^https?:\/\//, '')
    : globalThis.location.host;
  const params = new URLSearchParams({
    user_id: readStorage(USER_ID_STORAGE_KEY) || 'anon',
    name: readStorage(USER_EMAIL_STORAGE_KEY) || 'Anònim',
  });
  const path = canonicalizeVaultApiUrl(
    `/api/vault/collab/${encodeURIComponent(pageId)}`,
  );
  return `${protocol}://${host}${path}?${params.toString()}`;
}


/** BlockNote-compatible collaboration provider. */
export class GnosiCollabProvider {
  readonly awareness: Awareness;
  readonly doc: Y.Doc;
  readonly pageId: string;

  private closed = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private socket: WebSocket | null = null;

  private readonly awarenessHandler = ({
    added,
    removed,
    updated,
  }: AwarenessChange): void => {
    const changed = [...added, ...updated, ...removed];
    const update = encodeAwarenessUpdate(this.awareness, changed);
    this.send({ data: toBase64(update), type: 'yjs-awareness' });
  };

  private readonly docHandler = (
    update: Uint8Array,
    origin: unknown,
  ): void => {
    if (origin === this) return;
    this.send({ data: toBase64(update), type: 'yjs-update' });
  };

  constructor(pageId: string, doc: Y.Doc, user?: CollaborationUser) {
    this.pageId = pageId;
    this.doc = doc;
    this.awareness = new Awareness(doc);
    if (user) this.awareness.setLocalStateField('user', user);
    this.doc.on('update', this.docHandler);
    this.awareness.on('update', this.awarenessHandler);
    void this.connect();
  }

  private async connect(): Promise<void> {
    let socket: WebSocket;
    try {
      socket = openWebSocket(
        await buildCollaborationWebSocketUrl(this.pageId),
      );
    } catch {
      return;
    }
    if (this.closed) {
      socket.close();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      try {
        this.send({
          data: toBase64(Y.encodeStateAsUpdate(this.doc)),
          type: 'yjs-update',
        });
        this.send({
          data: toBase64(encodeAwarenessUpdate(
            this.awareness,
            [this.doc.clientID],
          )),
          type: 'yjs-awareness',
        });
      } catch {
        // A later local update will retry once the transport is usable.
      }
    };

    socket.onmessage = (event) => {
      const message = parseMessage(event.data);
      if (!message) return;
      try {
        const update = fromBase64(message.data);
        if (message.type === 'yjs-update') {
          Y.applyUpdate(this.doc, update, this);
        } else {
          applyAwarenessUpdate(this.awareness, update, this);
        }
      } catch {
        // Ignore malformed or incompatible peer payloads.
      }
    };

    socket.onclose = () => {
      if (!this.closed) {
        this.retry = setTimeout(() => {
          void this.connect();
        }, 3000);
      }
    };
    socket.onerror = () => {
      try {
        socket.close();
      } catch {
        // The close handler already owns retries.
      }
    };
  }

  private send(message: CollaborationMessage): void {
    if (this.socket?.readyState !== WEB_SOCKET_OPEN_STATE) return;
    try {
      this.socket.send(JSON.stringify(message));
    } catch {
      // Updates are eventually resent as full state after reconnecting.
    }
  }

  destroy(): void {
    this.closed = true;
    if (this.retry !== null) clearTimeout(this.retry);
    try {
      this.doc.off('update', this.docHandler);
    } catch {
      // The document may already have been destroyed by its owner.
    }
    try {
      this.awareness.off('update', this.awarenessHandler);
      this.awareness.destroy();
    } catch {
      // Awareness cleanup is idempotent from the provider's perspective.
    }
    try {
      this.socket?.close();
    } catch {
      // The socket can already be closed by the browser.
    }
    this.socket = null;
  }
}


export default GnosiCollabProvider;
