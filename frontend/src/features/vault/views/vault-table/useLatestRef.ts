import { useLayoutEffect, useRef } from 'react';

/** Keep global listeners current after commit, never exposing an abandoned render. */
export function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => { ref.current = value; }, [value]);
  return ref;
}
