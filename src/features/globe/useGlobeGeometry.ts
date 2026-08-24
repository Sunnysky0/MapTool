import { useEffect, useState } from 'react';
import { loadSourceMap } from '../../core/assets/load-source-map';
import {
  buildGlobeGeometry,
  type GlobeGeometry,
  type GlobeGeometryOptions,
} from './buildGlobeGeometry';

export interface GlobeGeometryState {
  geometry: GlobeGeometry | null;
  error: Error | null;
  loading: boolean;
}

export function useGlobeGeometry(options?: GlobeGeometryOptions): GlobeGeometryState {
  const [state, setState] = useState<GlobeGeometryState>({
    geometry: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    let active = true;
    let geometry: GlobeGeometry | null = null;

    void loadSourceMap('globe')
      .then((sourceMap) => {
        geometry = buildGlobeGeometry(sourceMap, options);
        if (active) {
          setState({ geometry, error: null, loading: false });
        } else {
          geometry.dispose();
        }
      })
      .catch((reason: unknown) => {
        if (!active) return;
        const error = reason instanceof Error ? reason : new Error(String(reason));
        setState({ geometry: null, error, loading: false });
      });

    return () => {
      active = false;
      geometry?.dispose();
    };
  }, [options]);

  return state;
}
