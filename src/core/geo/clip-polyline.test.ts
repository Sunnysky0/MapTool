import { describe, expect, it } from 'vitest';
import {
  clipPolylineToExtent,
  clipPolylineToRectangle,
  clipSegmentToRectangle,
} from './clip-polyline';

describe('polyline clipping', () => {
  const rectangle = { west: -10, east: 10, south: -5, north: 5 };

  it('clips crossing segments to each rectangle edge', () => {
    expect(
      clipSegmentToRectangle(
        { longitude: -20, latitude: 0 },
        { longitude: 20, latitude: 0 },
        rectangle,
      ),
    ).toEqual({
      start: { longitude: -10, latitude: 0 },
      end: { longitude: 10, latitude: 0 },
    });
    expect(
      clipSegmentToRectangle(
        { longitude: 0, latitude: -20 },
        { longitude: 0, latitude: 20 },
        rectangle,
      ),
    ).toEqual({
      start: { longitude: 0, latitude: -5 },
      end: { longitude: 0, latitude: 5 },
    });
    expect(
      clipSegmentToRectangle(
        { longitude: -20, latitude: -20 },
        { longitude: -15, latitude: -15 },
        rectangle,
      ),
    ).toBeNull();
  });

  it('preserves connected runs and separates disjoint visits', () => {
    expect(
      clipPolylineToRectangle(
        [
          { longitude: -20, latitude: 0 },
          { longitude: 0, latitude: 0 },
          { longitude: 20, latitude: 0 },
          { longitude: 20, latitude: 10 },
          { longitude: 0, latitude: 0 },
        ],
        rectangle,
      ),
    ).toEqual([
      [
        { longitude: -10, latitude: 0 },
        { longitude: 0, latitude: 0 },
        { longitude: 10, latitude: 0 },
      ],
      [
        { longitude: 10, latitude: 5 },
        { longitude: 0, latitude: 0 },
      ],
    ]);
  });

  it('clips normal extents after longitude unwrapping', () => {
    expect(
      clipPolylineToExtent(
        [
          { longitude: -30, latitude: 0 },
          { longitude: 30, latitude: 0 },
        ],
        { west: -10, east: 10, south: -5, north: 5, wrapsAntimeridian: false },
      ),
    ).toEqual([
      [
        { longitude: -10, latitude: 0 },
        { longitude: 10, latitude: 0 },
      ],
    ]);
  });

  it('clips wrapped extents locally across the antimeridian without a world-spanning chord', () => {
    expect(
      clipPolylineToExtent(
        [
          { longitude: 160, latitude: 0 },
          { longitude: 175, latitude: 0 },
          { longitude: -175, latitude: 0 },
          { longitude: -150, latitude: 0 },
        ],
        { west: 170, east: -160, south: -10, north: 10, wrapsAntimeridian: true },
      ),
    ).toEqual([
      [
        { longitude: 170, latitude: 0 },
        { longitude: 175, latitude: 0 },
        { longitude: 180, latitude: 0 },
      ],
      [
        { longitude: -180, latitude: 0 },
        { longitude: -175, latitude: 0 },
        { longitude: -160, latitude: 0 },
      ],
    ]);
  });

  it('handles a polar selection boundary and clips latitude exactly', () => {
    expect(
      clipPolylineToExtent(
        [
          { longitude: 0, latitude: 60 },
          { longitude: 0, latitude: 80 },
          { longitude: 0, latitude: 90 },
        ],
        { west: -45, east: 45, south: 70, north: 90, wrapsAntimeridian: false },
      ),
    ).toEqual([
      [
        { longitude: 0, latitude: 70 },
        { longitude: 0, latitude: 80 },
        { longitude: 0, latitude: 90 },
      ],
    ]);
  });
});
