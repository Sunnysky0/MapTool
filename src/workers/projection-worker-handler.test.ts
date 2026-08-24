import { describe, expect, it } from 'vitest';
import { createDefaultMapDocument } from '../core/model/map-document';
import type { SourceMapManifest } from '../types/source-map';
import { createProjectionWorkerHandler } from './projection-worker-handler';
import { WORKER_PROTOCOL_VERSION, type ProjectionWorkerRequest } from './protocol';

const calibration = {
  version: 1,
  method: 'artistic-plate-carree',
  xMin: 0,
  xMax: 360,
  yMin: 0,
  yMax: 180,
  longitudeRange: [-180, 180],
  latitudeRange: [-90, 90],
  yAxis: 'down',
} as const;
const lod = { file: 'empty.bin', pointCount: 0, tolerance: 0, features: [] };
const manifest: SourceMapManifest = {
  formatVersion: 1,
  compilerVersion: 'test',
  source: {
    file: 'source_map.svg',
    sha256: 'worker-fixture',
    license: 'Public Domain',
    title: 'Fixture',
  },
  calibration,
  stats: {
    sourcePathCount: 0,
    geographicPathCount: 0,
    decorativePathCount: 0,
    rejectedPathCount: 0,
    landPathCount: 0,
    lakePathCount: 0,
    globePointCount: 0,
    detailPointCount: 0,
    nonFinitePointCount: 0,
  },
  lods: { globe: lod, detail: lod },
  features: [],
};

function buildRequest(requestId: number, revision: number): ProjectionWorkerRequest {
  return {
    protocolVersion: WORKER_PROTOCOL_VERSION,
    type: 'build',
    requestId,
    revision,
    precision: 'preview',
    document: createDefaultMapDocument({
      file: 'source_map.svg',
      sha256: 'worker-fixture',
      calibration,
    }),
    source: { manifest, points: new Float32Array() },
  };
}

describe('projection worker handler', () => {
  it('returns serializable plans and reuses cached geometry with the requested revision', async () => {
    const handler = createProjectionWorkerHandler({ now: () => 1 });
    const first = await handler.handle(buildRequest(1, 1));
    const second = await handler.handle(buildRequest(2, 2));
    expect(first).toEqual(expect.objectContaining({ type: 'result', requestId: 1, revision: 1 }));
    expect(second).toEqual(expect.objectContaining({ type: 'result', requestId: 2, revision: 2 }));
    if (second?.type === 'result') {
      expect(second.plan.revision).toBe(2);
      expect(() => structuredClone(second)).not.toThrow();
    }
  });

  it('drops stale and cancelled requests', async () => {
    const handler = createProjectionWorkerHandler();
    expect(await handler.handle(buildRequest(3, 3))).not.toBeNull();
    expect(await handler.handle(buildRequest(2, 2))).toBeNull();
    await handler.handle({
      protocolVersion: WORKER_PROTOCOL_VERSION,
      type: 'cancel',
      requestId: 4,
    });
    expect(await handler.handle(buildRequest(4, 4))).toBeNull();
  });
});
