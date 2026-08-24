import { describe, expect, it } from 'vitest';
import { PROJECTION_CATALOG } from './catalog';
import { createProjection } from './create-projection';
import { densifyProjectedPolyline } from './densify';
import { WEB_MERCATOR_MAX_LATITUDE, validateProjection } from './validation';
import type { ProjectionId } from './types';

const world = {
  west: -180,
  east: 180,
  south: -80,
  north: 79,
  wrapsAntimeridian: false,
};

const expectedIds: ProjectionId[] = [
  'plate-carree',
  'mercator',
  'equal-earth',
  'natural-earth-1',
  'winkel-tripel',
  'lambert-azimuthal-equal-area',
];

describe('projection registry and creation', () => {
  it('registers six projections with stable IDs and Chinese metadata', () => {
    expect(PROJECTION_CATALOG.map(({ id }) => id)).toEqual(expectedIds);
    for (const metadata of PROJECTION_CATALOG) {
      expect(metadata.name).toMatch(/[㐀-鿿]/u);
      expect(metadata.category).toMatch(/[㐀-鿿]/u);
      expect(metadata.validation).toBeTruthy();
    }
  });

  it.each(expectedIds)('creates and aspect-fits %s deterministically', (id) => {
    const extent =
      id === 'lambert-azimuthal-equal-area'
        ? { west: -120, east: 120, south: -60, north: 60, wrapsAntimeridian: false }
        : world;
    const first = createProjection({
      id,
      extent,
      viewport: { width: 1000, height: 600, padding: 20 },
    });
    const second = createProjection({
      id,
      extent,
      viewport: { width: 1000, height: 600, padding: 20 },
    });
    expect(first.center).toEqual([0, (extent.south + extent.north) / 2]);
    expect(first.boundary).toEqual(second.boundary);
    expect(first.boundary.length).toBeGreaterThanOrEqual(5);
    for (const [x, y] of first.boundary) {
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(19.999999);
      expect(x).toBeLessThanOrEqual(980.000001);
      expect(y).toBeGreaterThanOrEqual(19.999999);
      expect(y).toBeLessThanOrEqual(580.000001);
    }
  });

  it('auto-centers an antimeridian selection', () => {
    const created = createProjection({
      id: 'equal-earth',
      extent: { west: 170, east: -150, south: -20, north: 40, wrapsAntimeridian: true },
      viewport: { width: 800, height: 500, padding: 24 },
    });
    expect(created.center).toEqual([-170, 10]);
    expect(created.boundary.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
  });

  it('rejects Mercator polar input without clamping the extent', () => {
    const extent = { ...world, north: WEB_MERCATOR_MAX_LATITUDE + 0.001 };
    const validation = validateProjection('mercator', extent, [0, 0]);
    expect(validation).toEqual(
      expect.objectContaining({
        valid: false,
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'mercator-latitude-domain' }),
        ]),
      }),
    );
    expect(() =>
      createProjection({
        id: 'mercator',
        extent,
        viewport: { width: 800, height: 600 },
      }),
    ).toThrow(/mercator-latitude-domain/);
    expect(extent.north).toBe(WEB_MERCATOR_MAX_LATITUDE + 0.001);
  });

  it('rejects a Lambert extent containing the center antipode', () => {
    const extent = {
      west: -180,
      east: 180,
      south: -90,
      north: 90,
      wrapsAntimeridian: false,
    };
    const validation = validateProjection('lambert-azimuthal-equal-area', extent, [0, 0]);
    expect(validation.valid).toBe(false);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({ code: 'lambert-antipode-singularity', position: [180, 0] }),
    );
  });

  it('densifies projected segments and honors point guards', () => {
    const { projection } = createProjection({
      id: 'mercator',
      extent: { ...world, west: -60, east: 60 },
      viewport: { width: 800, height: 600, padding: 20 },
    });
    const dense = densifyProjectedPolyline(
      [
        { longitude: -60, latitude: -70 },
        { longitude: 60, latitude: 0 },
      ],
      projection,
      { tolerance: 0.01, maxDepth: 12, maxPoints: 1000 },
    );
    expect(dense.points.length).toBeGreaterThan(2);

    const guarded = densifyProjectedPolyline(
      [
        { longitude: -60, latitude: -70 },
        { longitude: 60, latitude: 0 },
      ],
      projection,
      { tolerance: 0.000001, maxDepth: 20, maxPoints: 3 },
    );
    expect(guarded.points.length).toBeLessThanOrEqual(3);
    expect(guarded.stats.pointLimitReached).toBe(true);
  });
});
