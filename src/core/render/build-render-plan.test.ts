import { describe, expect, it } from 'vitest';
import { createDefaultMapDocument } from '../model/map-document';
import type { LoadedSourceMap, SourceMapFeature, SourceMapManifest } from '../../types/source-map';
import { buildRenderPlan } from './build-render-plan';

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

function sourceMap(points: readonly number[], features: SourceMapFeature[]): LoadedSourceMap {
  const lod = { file: 'fixture.bin', pointCount: points.length / 2, tolerance: 0, features };
  const manifest: SourceMapManifest = {
    formatVersion: 1,
    compilerVersion: 'test',
    source: {
      file: 'source_map.svg',
      sha256: 'fixture-hash',
      license: 'Public Domain',
      title: 'Fixture',
    },
    calibration,
    stats: {
      sourcePathCount: features.length,
      geographicPathCount: features.length,
      decorativePathCount: 0,
      rejectedPathCount: 0,
      landPathCount: features.filter(({ layer }) => layer === 'land').length,
      lakePathCount: features.filter(({ layer }) => layer === 'lake').length,
      globePointCount: points.length / 2,
      detailPointCount: points.length / 2,
      nonFinitePointCount: 0,
    },
    lods: { globe: lod, detail: lod },
    features,
  };
  return { manifest, points: new Float32Array(points) };
}

function sourceReference() {
  return { file: 'source_map.svg', sha256: 'fixture-hash', calibration };
}

describe('buildRenderPlan', () => {
  it('clips source coordinates geographically and preserves feature metadata', () => {
    // SVG x values map to longitudes -30, 0, 30; y=90 maps to latitude 0.
    const source = sourceMap(
      [150, 90, 180, 90, 210, 90],
      [
        {
          index: 0,
          layer: 'land',
          countryCode: 'TST',
          sourcePathId: 'country-test',
          pointOffset: 0,
          pointCount: 3,
          subpaths: [{ pointOffset: 0, pointCount: 3, closed: false }],
        },
      ],
    );
    const document = createDefaultMapDocument(sourceReference(), {
      extent: { west: -10, east: 10, south: -10, north: 10, wrapsAntimeridian: false },
      canvas: { width: 400, height: 300, padding: 20 },
      style: {
        ...createDefaultMapDocument(sourceReference()).style,
        graticule: {
          ...createDefaultMapDocument(sourceReference()).style.graticule,
          visible: false,
        },
        extentFrame: { color: '#fff', width: 1, visible: true },
      },
    });

    const first = buildRenderPlan(document, source, { revision: 7, now: () => 10 });
    const second = buildRenderPlan(document, source, { revision: 7, now: () => 10 });
    expect(first).toEqual(second);
    expect(first.revision).toBe(7);
    expect(first.sourceHash).toBe('fixture-hash');
    expect(first.lineRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          layer: 'map-linework',
          sourceLayer: 'land',
          countryCode: 'TST',
          sourcePathId: 'country-test',
        }),
        expect.objectContaining({ layer: 'extent-frame', closed: true }),
      ]),
    );
    const linework = first.lineRuns.find(({ layer }) => layer === 'map-linework')!;
    expect(linework.points.length).toBeGreaterThanOrEqual(2);
    expect(linework.points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(
      true,
    );
  });

  it('fits an empty ocean extent independently of linework', () => {
    const source = sourceMap([], []);
    const document = createDefaultMapDocument(sourceReference(), {
      extent: { west: 100, east: 120, south: -10, north: 10, wrapsAntimeridian: false },
      canvas: { width: 500, height: 300, padding: 24 },
      style: {
        ...createDefaultMapDocument(sourceReference()).style,
        graticule: {
          ...createDefaultMapDocument(sourceReference()).style.graticule,
          visible: false,
        },
      },
    });
    const plan = buildRenderPlan(document, source, { now: () => 0 });
    expect(plan.boundary.length).toBeGreaterThanOrEqual(5);
    expect(plan.lineRuns.filter(({ layer }) => layer === 'map-linework')).toEqual([]);
    expect(plan.stats.inputPoints).toBe(0);
  });

  it('rejects a source hash mismatch', () => {
    const source = sourceMap([], []);
    const document = createDefaultMapDocument({ ...sourceReference(), sha256: 'other' });
    expect(() => buildRenderPlan(document, source)).toThrow(/哈希/);
  });
});
