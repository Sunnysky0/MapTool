import { describe, expect, it } from 'vitest';
import {
  intersectRaySphere,
  lonLatToXyz,
  normalizeLongitude,
  normalizeRadians,
  normalizeVector,
  sampleMeridian,
  sampleParallel,
  xyzToLonLat,
} from './spherical';

describe('spherical math', () => {
  it('converts cardinal lon/lat positions to a Y-up sphere', () => {
    expect(lonLatToXyz({ longitude: 0, latitude: 0 })).toEqual({ x: 1, y: 0, z: 0 });
    expect(lonLatToXyz({ longitude: 90, latitude: 0 })).toEqual({
      x: expect.closeTo(0, 12),
      y: 0,
      z: 1,
    });
    expect(lonLatToXyz({ longitude: 0, latitude: 90 })).toEqual({
      x: expect.closeTo(0, 12),
      y: 1,
      z: 0,
    });
  });

  it('round-trips ordinary, wrapped, and near-polar coordinates', () => {
    for (const point of [
      { longitude: 12.5, latitude: -42.25 },
      { longitude: 179.9, latitude: 10 },
      { longitude: -135, latitude: 89.999 },
    ]) {
      const actual = xyzToLonLat(lonLatToXyz(point));
      expect(actual?.longitude).toBeCloseTo(point.longitude, 9);
      expect(actual?.latitude).toBeCloseTo(point.latitude, 9);
    }
    expect(xyzToLonLat({ x: 0, y: 0, z: 0 })).toBeNull();
  });

  it('normalizes angles and vectors', () => {
    expect(normalizeLongitude(540)).toBe(180);
    expect(normalizeLongitude(-540)).toBe(-180);
    expect(normalizeLongitude(361)).toBe(1);
    expect(normalizeRadians(3 * Math.PI)).toBeCloseTo(-Math.PI);
    expect(normalizeVector({ x: 0, y: 3, z: 4 })).toEqual({ x: 0, y: 0.6, z: 0.8 });
    expect(normalizeVector({ x: 0, y: 0, z: 0 })).toBeNull();
  });

  it('returns the nearest forward ray-sphere hit, including inside and tangent rays', () => {
    expect(
      intersectRaySphere({ origin: { x: 0, y: 0, z: 3 }, direction: { x: 0, y: 0, z: -2 } }),
    ).toEqual({
      x: 0,
      y: 0,
      z: 1,
    });
    expect(
      intersectRaySphere({ origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }),
    ).toEqual({
      x: 1,
      y: 0,
      z: 0,
    });
    expect(
      intersectRaySphere({ origin: { x: 1, y: 0, z: 2 }, direction: { x: 0, y: 0, z: -1 } }),
    ).toEqual({
      x: 1,
      y: 0,
      z: 0,
    });
    expect(
      intersectRaySphere({ origin: { x: 0, y: 0, z: 3 }, direction: { x: 0, y: 1, z: 0 } }),
    ).toBeNull();
  });

  it('samples meridians and unwrapped parallels with exact endpoints', () => {
    expect(sampleMeridian(30, -90, 90, 2)).toEqual([
      { longitude: 30, latitude: -90 },
      { longitude: 30, latitude: 0 },
      { longitude: 30, latitude: 90 },
    ]);
    expect(sampleParallel(60, 170, 190, 2)).toEqual([
      { longitude: 170, latitude: 60 },
      { longitude: 180, latitude: 60 },
      { longitude: 190, latitude: 60 },
    ]);
  });
});
