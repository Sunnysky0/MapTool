import type { GeographicExtent } from '../model/map-document';
import { assertValidExtent, extentCenterLongitude, extentLongitudeWindows } from './extent';
import type { LonLat } from './spherical';
import { splitAntimeridian } from './split-antimeridian';

const EPSILON = 1e-10;

export interface ClipRectangle {
  west: number;
  east: number;
  south: number;
  north: number;
}

interface ClippedSegment {
  start: LonLat;
  end: LonLat;
}

function samePoint(left: LonLat, right: LonLat): boolean {
  return (
    Math.abs(left.longitude - right.longitude) <= EPSILON &&
    Math.abs(left.latitude - right.latitude) <= EPSILON
  );
}

/** Liang-Barsky line clipping against a closed lon/lat rectangle. */
export function clipSegmentToRectangle(
  start: LonLat,
  end: LonLat,
  rectangle: ClipRectangle,
): ClippedSegment | null {
  const deltaLongitude = end.longitude - start.longitude;
  const deltaLatitude = end.latitude - start.latitude;
  let minimum = 0;
  let maximum = 1;

  const edges: ReadonlyArray<readonly [number, number]> = [
    [-deltaLongitude, start.longitude - rectangle.west],
    [deltaLongitude, rectangle.east - start.longitude],
    [-deltaLatitude, start.latitude - rectangle.south],
    [deltaLatitude, rectangle.north - start.latitude],
  ];

  for (const [direction, distance] of edges) {
    if (Math.abs(direction) <= EPSILON) {
      if (distance < -EPSILON) return null;
      continue;
    }
    const ratio = distance / direction;
    if (direction < 0) {
      if (ratio > maximum + EPSILON) return null;
      minimum = Math.max(minimum, ratio);
    } else {
      if (ratio < minimum - EPSILON) return null;
      maximum = Math.min(maximum, ratio);
    }
  }

  const interpolate = (fraction: number): LonLat => ({
    longitude: start.longitude + deltaLongitude * fraction,
    latitude: start.latitude + deltaLatitude * fraction,
  });
  return { start: interpolate(minimum), end: interpolate(maximum) };
}

export function clipPolylineToRectangle(
  points: readonly LonLat[],
  rectangle: ClipRectangle,
): LonLat[][] {
  if (points.length < 2) return [];
  if (
    !Number.isFinite(rectangle.west) ||
    !Number.isFinite(rectangle.east) ||
    !Number.isFinite(rectangle.south) ||
    !Number.isFinite(rectangle.north) ||
    rectangle.west > rectangle.east ||
    rectangle.south > rectangle.north
  ) {
    throw new RangeError('Clip rectangle bounds are invalid.');
  }

  const runs: LonLat[][] = [];
  let current: LonLat[] | null = null;

  for (let index = 1; index < points.length; index += 1) {
    const clipped = clipSegmentToRectangle(points[index - 1]!, points[index]!, rectangle);
    if (!clipped) {
      current = null;
      continue;
    }

    if (!current || !samePoint(current[current.length - 1]!, clipped.start)) {
      current = [clipped.start, clipped.end];
      runs.push(current);
    } else if (!samePoint(current[current.length - 1]!, clipped.end)) {
      current.push(clipped.end);
    }
  }

  return runs.filter((run) => run.length >= 2 && !run.every((point) => samePoint(point, run[0]!)));
}

/**
 * Splits linework at the antimeridian, then clips against each canonical extent
 * window. Wrapped extents therefore produce separate western/eastern runs and
 * can never reintroduce a world-spanning segment after clipping.
 */
export function clipPolylineToExtent(
  points: readonly LonLat[],
  extent: GeographicExtent,
): LonLat[][] {
  assertValidExtent(extent);
  if (points.length < 2) return [];

  const seamRuns = splitAntimeridian(points, extentCenterLongitude(extent));
  const windows = extentLongitudeWindows(extent);
  const clipped: LonLat[][] = [];
  for (const run of seamRuns) {
    for (const window of windows) {
      clipped.push(
        ...clipPolylineToRectangle(run, {
          ...window,
          south: extent.south,
          north: extent.north,
        }),
      );
    }
  }
  return clipped;
}
