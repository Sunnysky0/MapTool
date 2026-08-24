import type { MapDocument } from '../core/model/map-document';
import type { RenderPlan } from '../core/render/render-plan';
import type { LoadedSourceMap, SourceMapManifest } from '../types/source-map';

export const WORKER_PROTOCOL_VERSION = 1 as const;

export interface SerializedSourceMap {
  manifest: SourceMapManifest;
  points: Float32Array;
}

export type ProjectionWorkerRequest =
  | {
      protocolVersion: 1;
      type: 'build';
      requestId: number;
      revision: number;
      document: MapDocument;
      source: SerializedSourceMap;
      precision: 'preview' | 'export';
    }
  | {
      protocolVersion: 1;
      type: 'cancel';
      requestId: number;
    };

export type ProjectionWorkerResponse =
  | {
      protocolVersion: 1;
      type: 'result';
      requestId: number;
      revision: number;
      plan: RenderPlan;
    }
  | {
      protocolVersion: 1;
      type: 'error';
      requestId: number;
      revision: number;
      message: string;
    };

export function toLoadedSourceMap(source: SerializedSourceMap): LoadedSourceMap {
  return source;
}
