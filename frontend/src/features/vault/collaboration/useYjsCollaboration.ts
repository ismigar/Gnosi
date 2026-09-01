/**
 * Builds BlockNote collaboration state only for organization workspaces.
 */
import { useEffect, useState } from 'react';
import * as Y from 'yjs';

import {
  GnosiCollabProvider,
  type CollaborationUser,
} from './collabProvider';
import {
  USER_EMAIL_STORAGE_KEY,
  USER_ID_STORAGE_KEY,
} from '../../../shared/api/request-context';
import { fetchSystemHealth } from '../../../shared/api/system';
import { readStorage } from '../../../shared/platform/browser-storage';


type GnosiMode = 'org' | 'personal';


export interface YjsCollaborationState {
  readonly fragment: Y.XmlFragment;
  readonly provider: GnosiCollabProvider;
  readonly user: CollaborationUser;
}


export interface UseYjsCollaborationResult {
  readonly collaboration: YjsCollaborationState | undefined;
  readonly ready: boolean;
}


interface CollaborationResource {
  readonly pageId: string;
  readonly state: YjsCollaborationState;
}


let modePromise: Promise<GnosiMode> | null = null;


function resolveMode(): Promise<GnosiMode> {
  modePromise ??= fetchSystemHealth().then(
    ({ gnosi_mode: mode }) => mode === 'org' ? 'org' : 'personal',
    () => 'personal',
  );
  return modePromise;
}


const DEFAULT_CURSOR_COLOR = '#ef4444';
const CURSOR_COLORS = [
  DEFAULT_CURSOR_COLOR,
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
] as const;


export function collaborationColorFor(id: string): string {
  let hash = 0;
  for (const character of id) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return CURSOR_COLORS.at(Math.abs(hash) % CURSOR_COLORS.length)
    ?? DEFAULT_CURSOR_COLOR;
}


function destroyProvider(provider: GnosiCollabProvider | null): void {
  if (!provider) return;
  try {
    provider.destroy();
  } catch {
    // Cleanup remains safe if an owner already destroyed the provider.
  }
}


export function useYjsCollaboration(
  pageId: string | null | undefined,
): UseYjsCollaborationResult {
  const [isOrganization, setIsOrganization] = useState(false);
  const [resource, setResource] = useState<CollaborationResource | null>(null);

  useEffect(() => {
    let cancelled = false;
    void resolveMode().then((mode) => {
      if (!cancelled) setIsOrganization(mode === 'org');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enabled = isOrganization && Boolean(pageId);

  useEffect(() => {
    let active = true;
    if (!enabled || !pageId) {
      queueMicrotask(() => {
        if (active) setResource(null);
      });
      return () => {
        active = false;
      };
    }

    const document = new Y.Doc();
    const userId = readStorage(USER_ID_STORAGE_KEY) || 'anon';
    const email = readStorage(USER_EMAIL_STORAGE_KEY) || 'Anònim';
    const user: CollaborationUser = {
      color: collaborationColorFor(userId),
      name: email.split('@').at(0) || 'Anònim',
    };
    const provider = new GnosiCollabProvider(pageId, document, user);
    const nextResource: CollaborationResource = {
      pageId,
      state: {
        fragment: document.getXmlFragment('document-store'),
        provider,
        user,
      },
    };
    queueMicrotask(() => {
      if (active) setResource(nextResource);
    });

    return () => {
      active = false;
      destroyProvider(provider);
    };
  }, [enabled, pageId]);

  const collaboration = enabled
    && pageId
    && resource?.pageId === pageId
    ? resource.state
    : undefined;

  return { collaboration, ready: collaboration !== undefined };
}


export default useYjsCollaboration;
