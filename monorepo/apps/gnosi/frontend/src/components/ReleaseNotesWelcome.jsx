import React, { useState } from 'react';

import { APP_VERSION } from '../lib/version';
import { findRelease, releaseSeenStorageKey } from '../lib/releaseNotes';
import { ReleaseNotesDialog } from './ReleaseNotesDialog';

export function ReleaseNotesWelcome() {
  const release = findRelease(APP_VERSION);
  const [open, setOpen] = useState(() => {
    if (!release) return false;
    try {
      return localStorage.getItem(releaseSeenStorageKey(release.version)) !== 'true';
    } catch {
      return false;
    }
  });

  const close = () => {
    if (release) {
      try {
        localStorage.setItem(releaseSeenStorageKey(release.version), 'true');
      } catch {
        // Storage can be unavailable in hardened browser contexts.
      }
    }
    setOpen(false);
  };

  return <ReleaseNotesDialog open={open} onClose={close} initialVersion={release?.version} />;
}
