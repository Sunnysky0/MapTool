import { useEffect, useRef, useState } from 'react';
import type { LayerData, MapConfig } from '../types';
import { LAYER_DEFS, layerDataKey, loadLayerData, scenarioKey } from '../lib/data';

export interface DataStore {
  data: Record<string, LayerData | undefined>;
  loading: string[];
  errors: Record<string, string>;
}

export function useLayerData(config: MapConfig) {
  const [store, setStore] = useState<DataStore>({ data: {}, loading: [], errors: {} });
  const inflight = useRef(new Set<string>());

  // Keys required by currently visible layers
  const needed: string[] = config.scenario ? [scenarioKey(config.scenario)] : [];
  for (const def of LAYER_DEFS) {
    const style = config.layers[def.id];
    if (!style.visible) continue;
    const key = layerDataKey(def.id, style, config.coastDetail, config.waterDetail, config.scenario);
    if (key && !needed.includes(key)) needed.push(key);
  }
  const neededKey = needed.join('|');

  useEffect(() => {
    for (const key of needed) {
      if (store.data[key] || inflight.current.has(key) || store.errors[key]) continue;
      inflight.current.add(key);
      setStore((s) => ({ ...s, loading: [...s.loading, key] }));
      loadLayerData(key)
        .then((d) => {
          setStore((s) => ({ ...s, data: { ...s.data, [key]: d }, loading: s.loading.filter((k) => k !== key) }));
        })
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : 'Failed to load';
          setStore((s) => ({ ...s, errors: { ...s.errors, [key]: msg }, loading: s.loading.filter((k) => k !== key) }));
        })
        .finally(() => inflight.current.delete(key));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neededKey, store.errors]);

  const retry = (key: string) =>
    setStore((s) => {
      const errors = { ...s.errors };
      delete errors[key];
      return { ...s, errors };
    });

  return { data: store.data, loading: needed.filter((key) => !store.data[key] && !store.errors[key]),
    errors: Object.fromEntries(Object.entries(store.errors).filter(([key]) => needed.includes(key))), retry };
}
