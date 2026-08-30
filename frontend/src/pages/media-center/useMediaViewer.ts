import {useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction} from 'react';
import {subscribeDocumentEvent} from '../../shared/platform/browser-events';
import type {MediaAsset} from './model';
import {enterMediaFullscreen, exitMediaFullscreen} from './fullscreen';
export function useMediaViewer(filteredMedia: MediaAsset[], selectedPhoto: MediaAsset | null, handlePhotoClick: (item: MediaAsset) => void, setSelectedPhoto: Dispatch<SetStateAction<MediaAsset | null>>) {
  const [slideshowActive, setSlideshowActive] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const viewerRootRef = useRef<HTMLDivElement>(null);
  const SLIDESHOW_INTERVAL_MS = 4000;

  const currentIndex = selectedPhoto
    ? filteredMedia.findIndex((m) => m.id === selectedPhoto.id)
    : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < filteredMedia.length - 1;

  const goPrev = useCallback(() => {
    if (currentIndex <= 0) return;
    const previous = filteredMedia[currentIndex - 1];
    if (previous) handlePhotoClick(previous);
  }, [currentIndex, filteredMedia, handlePhotoClick]);

  const goNext = useCallback(() => {
    if (currentIndex < 0 || currentIndex >= filteredMedia.length - 1) return;
    const next = filteredMedia[currentIndex + 1];
    if (next) handlePhotoClick(next);
  }, [currentIndex, filteredMedia, handlePhotoClick]);

  const closeViewer = useCallback(() => {
    setSelectedPhoto(null);
    setSlideshowActive(false);
    if (document.fullscreenElement) {
      exitMediaFullscreen();
    }
  }, [setSelectedPhoto]);

  const toggleFullscreen = useCallback(() => {
    const el = viewerRootRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      enterMediaFullscreen(el);
    } else {
      exitMediaFullscreen();
    }
  }, []);

  // Syncs `isFullscreen` with the browser's actual state (the user can
  // exit with native Esc, not just with the button).
  useEffect(() => {
    const onFs = () => { setIsFullscreen(!!document.fullscreenElement); };
    return subscribeDocumentEvent('fullscreenchange', onFs);
  }, []);

  // Global keyboard shortcut while the viewer is open. We ignore it if the user
  // is typing in an input/textarea (tags, description, etc).
  useEffect(() => {
    if (!selectedPhoto) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = e.target instanceof Element ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeViewer();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      } else if (e.key === ' ') {
        e.preventDefault();
        setSlideshowActive((s) => !s);
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    return subscribeDocumentEvent('keydown', onKey);
  }, [selectedPhoto, goPrev, goNext, toggleFullscreen, closeViewer]);

  // Slideshow: every SLIDESHOW_INTERVAL_MS it moves to the next one. It stops when
  // it reaches the end or when the user disables it. It restarts when
  // the current item changes so that each item gets a fresh timer.
  useEffect(() => {
    if (!slideshowActive || !selectedPhoto) return;
    const t = setTimeout(() => {
      if (hasNext) goNext();
      else setSlideshowActive(false);
    }, SLIDESHOW_INTERVAL_MS);
    return () => { clearTimeout(t); };
  }, [slideshowActive, selectedPhoto, hasNext, goNext]);


return {slideshowActive, setSlideshowActive, isFullscreen, viewerRootRef, currentIndex, hasPrev, hasNext, goPrev, goNext, closeViewer, toggleFullscreen};
}
