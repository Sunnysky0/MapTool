import type { GeoProjection } from 'd3-geo';
import type { LonLat } from '../geo/spherical';

export interface ProjectedPoint {
  x: number;
  y: number;
}

export interface DensifyOptions {
  tolerance?: number;
  maxDepth?: number;
  maxPoints?: number;
}

export interface DensifyStats {
  subdivisions: number;
  maxDepthReached: boolean;
  pointLimitReached: boolean;
  droppedPoints: number;
}

export interface DensifyResult {
  points: ProjectedPoint[];
  stats: DensifyStats;
}

interface ValidatedDensifyOptions {
  tolerance: number;
  maxDepth: number;
  maxPoints: number;
}

const DEFAULT_OPTIONS: ValidatedDensifyOptions = {
  tolerance: 0.35,
  maxDepth: 16,
  maxPoints: 100_000,
};

function validateOptions(options: DensifyOptions): ValidatedDensifyOptions {
  const result = { ...DEFAULT_OPTIONS, ...options };
  if (!Number.isFinite(result.tolerance) || result.tolerance <= 0) {
    throw new RangeError('Densification tolerance must be greater than zero.');
  }
  if (!Number.isInteger(result.maxDepth) || result.maxDepth < 0) {
    throw new RangeError('Densification maxDepth must be a non-negative integer.');
  }
  if (!Number.isInteger(result.maxPoints) || result.maxPoints < 2) {
    throw new RangeError('Densification maxPoints must be an integer of at least two.');
  }
  return result;
}

function projectPoint(projection: GeoProjection, point: LonLat): ProjectedPoint | null {
  const projected = projection([point.longitude, point.latitude]);
  if (!projected || !Number.isFinite(projected[0]) || !Number.isFinite(projected[1])) return null;
  return { x: projected[0], y: projected[1] };
}

function geographicMidpoint(start: LonLat, end: LonLat): LonLat {
  let delta = end.longitude - start.longitude;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  let longitude = start.longitude + delta / 2;
  if (longitude > 180) longitude -= 360;
  if (longitude < -180) longitude += 360;
  return { longitude, latitude: (start.latitude + end.latitude) / 2 };
}

function midpointError(start: ProjectedPoint, end: ProjectedPoint, middle: ProjectedPoint): number {
  return Math.hypot(middle.x - (start.x + end.x) / 2, middle.y - (start.y + end.y) / 2);
}

/**
 * Adaptively densifies a geographic polyline by measuring projected midpoint
 * error. The returned points are already projected and safe for render plans.
 */
export function densifyProjectedPolyline(
  geographic: readonly LonLat[],
  projection: GeoProjection,
  options: DensifyOptions = {},
): DensifyResult {
  const settings = validateOptions(options);
  const stats: DensifyStats = {
    subdivisions: 0,
    maxDepthReached: false,
    pointLimitReached: false,
    droppedPoints: 0,
  };
  if (geographic.length < 2) return { points: [], stats };

  const output: ProjectedPoint[] = [];
  const append = (point: ProjectedPoint): boolean => {
    if (output.length >= settings.maxPoints) {
      stats.pointLimitReached = true;
      return false;
    }
    const previous = output[output.length - 1];
    if (!previous || previous.x !== point.x || previous.y !== point.y) output.push(point);
    return true;
  };

  const subdivide = (
    startGeo: LonLat,
    endGeo: LonLat,
    start: ProjectedPoint,
    end: ProjectedPoint,
    depth: number,
  ): boolean => {
    const middleGeo = geographicMidpoint(startGeo, endGeo);
    const middle = projectPoint(projection, middleGeo);
    if (!middle) {
      stats.droppedPoints += 1;
      return append(end);
    }
    const needsSubdivision = midpointError(start, end, middle) > settings.tolerance;
    if (!needsSubdivision) return append(end);
    if (depth >= settings.maxDepth) {
      stats.maxDepthReached = true;
      return append(end);
    }
    if (output.length + 2 > settings.maxPoints) {
      stats.pointLimitReached = true;
      return false;
    }

    stats.subdivisions += 1;
    return (
      subdivide(startGeo, middleGeo, start, middle, depth + 1) &&
      subdivide(middleGeo, endGeo, middle, end, depth + 1)
    );
  };

  let previousGeo = geographic[0]!;
  let previousProjected = projectPoint(projection, previousGeo);
  if (previousProjected) append(previousProjected);
  else stats.droppedPoints += 1;

  for (let index = 1; index < geographic.length && !stats.pointLimitReached; index += 1) {
    const currentGeo = geographic[index]!;
    const currentProjected = projectPoint(projection, currentGeo);
    if (!currentProjected) {
      stats.droppedPoints += 1;
      previousGeo = currentGeo;
      previousProjected = null;
      continue;
    }
    if (!previousProjected) append(currentProjected);
    else subdivide(previousGeo, currentGeo, previousProjected, currentProjected, 0);
    previousGeo = currentGeo;
    previousProjected = currentProjected;
  }

  return { points: output, stats };
}
