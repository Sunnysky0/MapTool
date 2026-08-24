import { describe, expect, it } from 'vitest';
import {
  containsLonLat,
  extentCenterLongitude,
  extentLongitudeWindows,
  longitudeSpan,
  validateExtent,
} from './extent';

const normal = {
  west: -20,
  east: 40,
  south: -10,
  north: 30,
  wrapsAntimeridian: false,
};

const wrapped = {
  west: 170,
  east: -160,
  south: -20,
  north: 40,
  wrapsAntimeridian: true,
};

describe('geographic extents', () => {
  it('calculates normal and wrapped spans and centers', () => {
    expect(longitudeSpan(normal)).toBe(60);
    expect(extentCenterLongitude(normal)).toBe(10);
    expect(longitudeSpan(wrapped)).toBe(30);
    expect(extentCenterLongitude(wrapped)).toBe(-175);
  });

  it('uses explicit antimeridian containment semantics', () => {
    expect(containsLonLat(wrapped, 175, 0)).toBe(true);
    expect(containsLonLat(wrapped, -170, 0)).toBe(true);
    expect(containsLonLat(wrapped, 0, 0)).toBe(false);
    expect(extentLongitudeWindows(wrapped)).toEqual([
      { west: 170, east: 180 },
      { west: -180, east: -160 },
    ]);
  });

  it('accepts full world and polar extents without special clamping', () => {
    const world = {
      west: -180,
      east: 180,
      south: -90,
      north: 90,
      wrapsAntimeridian: false,
    };
    const northPolar = { west: -45, east: 135, south: 70, north: 90, wrapsAntimeridian: false };
    expect(validateExtent(world)).toEqual([]);
    expect(longitudeSpan(world)).toBe(360);
    expect(validateExtent(northPolar)).toEqual([]);
    expect(containsLonLat(northPolar, 20, 90)).toBe(true);
  });

  it('rejects implicit wraps, inconsistent wrap flags, empty latitude, and out-of-range poles', () => {
    expect(validateExtent({ ...normal, west: 50, east: 10 })).toContainEqual(
      expect.objectContaining({ field: 'east' }),
    );
    expect(validateExtent({ ...normal, wrapsAntimeridian: true })).toContainEqual(
      expect.objectContaining({ field: 'wrapsAntimeridian' }),
    );
    expect(validateExtent({ ...normal, north: -10 })).toContainEqual(
      expect.objectContaining({ field: 'north' }),
    );
    expect(validateExtent({ ...normal, north: 91 })).toContainEqual(
      expect.objectContaining({ field: 'north' }),
    );
  });
});
