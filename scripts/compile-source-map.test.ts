// @vitest-environment node

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  compileSourceMap,
  DETAIL_TOLERANCE,
  GLOBE_TOLERANCE,
  runCompiler,
} from './compile-source-map.ts';

const rootDir = path.resolve(import.meta.dirname, '..');
const sourceFile = path.join(rootDir, 'source_map.svg');

async function compileFixture() {
  return compileSourceMap(await readFile(sourceFile));
}

function readPoint(bytes: Uint8Array, pointIndex: number): { x: number; y: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    x: view.getFloat32(pointIndex * 8, true),
    y: view.getFloat32(pointIndex * 8 + 4, true),
  };
}

function featureById(
  features: Awaited<ReturnType<typeof compileFixture>>['manifest']['features'],
  sourcePathId: string,
) {
  const feature = features.find((candidate) => candidate.sourcePathId === sourcePathId);
  if (!feature) throw new Error(`Feature not found: ${sourcePathId}`);
  return feature;
}

describe('source SVG compiler', () => {
  it('classifies every source path and excludes decorative ocean/circle paths', async () => {
    const { manifest } = await compileFixture();
    expect(manifest.source.sha256).toBe(
      'e6df9bb3ed524d4c256424a4112ffb15db0aa71f17e30b2416faa87406498273',
    );
    expect(manifest.stats).toMatchObject({
      sourcePathCount: 2_288,
      geographicPathCount: 2_212,
      decorativePathCount: 76,
      rejectedPathCount: 0,
      landPathCount: 2_197,
      lakePathCount: 15,
      nonFinitePointCount: 0,
    });
    expect(
      manifest.stats.geographicPathCount +
        manifest.stats.decorativePathCount +
        manifest.stats.rejectedPathCount,
    ).toBe(manifest.stats.sourcePathCount);
    expect(manifest.features.some((feature) => feature.sourcePathId === 'ocean')).toBe(false);
    expect(manifest.features.some((feature) => feature.sourcePathId.endsWith('.'))).toBe(false);
    expect(manifest.features.filter((feature) => feature.layer === 'lake')).toHaveLength(15);
  });

  it('derives calibration from the ocean inner frame', async () => {
    const { manifest } = await compileFixture();
    expect(manifest.calibration).toEqual({
      version: 1,
      method: 'artistic-plate-carree',
      xMin: -28.9472,
      xMax: 2723.1798,
      yMin: 61.9866,
      yMax: 1457.5605,
      longitudeRange: [-180, 180],
      latitudeRange: [-90, 90],
      yAxis: 'down',
    });
  });

  it('applies the exceptional Sudan and South Sudan translations', async () => {
    const { manifest, detail } = await compileFixture();
    const sudan = featureById(manifest.lods.detail.features, 'sd');
    const southSudan = featureById(manifest.lods.detail.features, 'ss');
    expect(readPoint(detail, sudan.pointOffset)).toEqual({
      x: expect.closeTo(1542.86525, 3),
      y: expect.closeTo(559.4241, 3),
    });
    expect(readPoint(detail, southSudan.pointOffset)).toEqual({
      x: expect.closeTo(1520.95895, 3),
      y: expect.closeTo(653.64285, 3),
    });
  });

  it('preserves subpaths/closed metadata and creates denser detail geometry', async () => {
    const { manifest, globe, detail } = await compileFixture();
    expect(manifest.lods.globe.tolerance).toBe(GLOBE_TOLERANCE);
    expect(manifest.lods.detail.tolerance).toBe(DETAIL_TOLERANCE);
    expect(manifest.lods.detail.pointCount).toBeGreaterThan(manifest.lods.globe.pointCount);
    expect(globe.byteLength).toBe(manifest.lods.globe.pointCount * 8);
    expect(detail.byteLength).toBe(manifest.lods.detail.pointCount * 8);
    expect(featureById(manifest.features, 'path3884').subpaths).toHaveLength(3);
    expect(
      manifest.features.some((feature) => feature.subpaths.some((subpath) => subpath.closed)),
    ).toBe(true);
    expect(manifest.lods.globe.features).toHaveLength(manifest.features.length);
    expect(manifest.lods.detail.features).toEqual(manifest.features);
  });

  it('emits only finite little-endian float pairs', async () => {
    const compiled = await compileFixture();
    for (const bytes of [compiled.globe, compiled.detail]) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let offset = 0; offset < bytes.byteLength; offset += 4) {
        if (!Number.isFinite(view.getFloat32(offset, true))) {
          throw new Error(`Non-finite Float32 at byte ${offset}.`);
        }
      }
    }
  });

  it('matches the checked-in generated assets byte-for-byte', async () => {
    await expect(runCompiler({ rootDir, check: true })).resolves.toBeDefined();
  });
});
