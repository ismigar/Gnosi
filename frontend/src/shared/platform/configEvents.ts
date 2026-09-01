import { useEffect, useRef } from 'react';

import { emitAppEvent, subscribeAppEvent } from './app-events';


type ChangeCallback = () => void;


function useAppChangeEvent(
  eventName: 'gnosi:config-changed' | 'gnosi:vault-name-changed',
  callback: ChangeCallback,
): void {
  const ref = useRef(callback);
  useEffect(() => {
    ref.current = callback;
  });
  useEffect(
    () => subscribeAppEvent(eventName, () => {
      ref.current();
    }),
    [eventName],
  );
}


export function emitConfigChanged(): void {
  emitAppEvent('gnosi:config-changed');
}


export function useConfigChanged(callback: ChangeCallback): void {
  useAppChangeEvent('gnosi:config-changed', callback);
}


export function emitVaultNameChanged(): void {
  emitAppEvent('gnosi:vault-name-changed');
}


export function useVaultNameChanged(callback: ChangeCallback): void {
  useAppChangeEvent('gnosi:vault-name-changed', callback);
}
