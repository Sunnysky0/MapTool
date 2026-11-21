import { useCallback, useRef, useState } from 'react';

export type Updater<T> = T | ((prev: T) => T);

export function useHistory<T>(initial: () => T, limit = 80) {
  const [state, setStateRaw] = useState<T>(initial);
  const stateRef = useRef<T>(state);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const pendingBase = useRef<T | null>(null);
  const [, bump] = useState(0);

  const apply = useCallback((next: T, notify = true) => {
    stateRef.current = next;
    if (notify) setStateRaw(next);
  }, []);

  /** Update state. Transient updates (drags) are grouped until commit(). */
  const set = useCallback(
    (updater: Updater<T>, transient = false, notify = true) => {
      const prev = stateRef.current;
      const next = typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater;
      if (next === prev) return;
      if (transient) {
        if (pendingBase.current === null) pendingBase.current = prev;
      } else {
        const basis = pendingBase.current ?? prev;
        pendingBase.current = null;
        past.current.push(basis);
        if (past.current.length > limit) past.current.shift();
        future.current = [];
      }
      apply(next, notify);
    },
    [apply, limit],
  );

  const commit = useCallback(() => {
    if (pendingBase.current === null) return;
    past.current.push(pendingBase.current);
    if (past.current.length > limit) past.current.shift();
    future.current = [];
    pendingBase.current = null;
    setStateRaw(stateRef.current);
    bump((n) => n + 1);
  }, [limit]);

  const undo = useCallback(() => {
    commit();
    const prev = past.current.pop();
    if (prev === undefined) return;
    future.current.push(stateRef.current);
    apply(prev);
  }, [apply, commit]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (next === undefined) return;
    past.current.push(stateRef.current);
    apply(next);
  }, [apply]);

  return {
    state,
    stateRef,
    set,
    commit,
    undo,
    redo,
    canUndo: past.current.length > 0 || pendingBase.current !== null,
    canRedo: future.current.length > 0,
  };
}
