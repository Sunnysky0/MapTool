import type { LonLat } from './spherical';

const LONGITUDE_PERIOD = 360;
const HALF_PERIOD = 180;
const EPSILON = 1e-10;

export function unwrapLongitude(longitude: number, centerLongitude: number): number {
  if (!Number.isFinite(longitude) || !Number.isFinite(centerLongitude)) return Number.NaN;
  return (
    longitude + LONGITUDE_PERIOD * Math.round((centerLongitude - longitude) / LONGITUDE_PERIOD)
  );
}

/** Unwraps a connected polyline while choosing its first revolution near center. */
export function unwrapPolylineRelativeToCenter(
  points: readonly LonLat[],
  centerLongitude: number,
): LonLat[] {
  if (points.length === 0) return [];
  const first = points[0]!;
  const unwrapped: LonLat[] = [
    { longitude: unwrapLongitude(first.longitude, centerLongitude), latitude: first.latitude },
  ];

  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    const previous = unwrapped[index - 1]!;
    let longitude = unwrapLongitude(point.longitude, previous.longitude);
    // Exactly opposite longitudes are ambiguous. Preserve the input's direction.
    if (Math.abs(Math.abs(longitude - previous.longitude) - HALF_PERIOD) <= EPSILON) {
      const rawDelta = point.longitude - points[index - 1]!.longitude;
      longitude = previous.longitude + Math.sign(rawDelta || 1) * HALF_PERIOD;
    }
    unwrapped.push({ longitude, latitude: point.latitude });
  }
  return unwrapped;
}

function seamBetween(start: number, end: number): number | null {
  if (Math.abs(end - start) <= EPSILON) return null;
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  const firstIndex = Math.ceil((low - HALF_PERIOD) / LONGITUDE_PERIOD);
  const lastIndex = Math.floor((high - HALF_PERIOD) / LONGITUDE_PERIOD);
  if (firstIndex > lastIndex) return null;

  if (end > start) {
    for (let index = firstIndex; index <= lastIndex; index += 1) {
      const seam = HALF_PERIOD + index * LONGITUDE_PERIOD;
      if (seam > start + EPSILON && seam < end - EPSILON) return seam;
    }
  } else {
    for (let index = lastIndex; index >= firstIndex; index -= 1) {
      const seam = HALF_PERIOD + index * LONGITUDE_PERIOD;
      if (seam < start - EPSILON && seam > end + EPSILON) return seam;
    }
  }
  return null;
}

function canonicalLongitude(longitude: number): number {
  const normalized =
    ((((longitude + HALF_PERIOD) % LONGITUDE_PERIOD) + LONGITUDE_PERIOD) % LONGITUDE_PERIOD) -
    HALF_PERIOD;
  if (Math.abs(normalized + HALF_PERIOD) <= EPSILON) {
    return longitude > 0 ? HALF_PERIOD : -HALF_PERIOD;
  }
  return normalized;
}

/**
 * Splits at every antimeridian crossing. Seam endpoints are duplicated as +180
 * on the western run and -180 on the eastern run, preventing a rendered chord.
 */
export function splitAntimeridian(points: readonly LonLat[], centerLongitude = 0): LonLat[][] {
  if (points.length === 0) return [];
  if (points.length === 1) {
    return [
      [{ longitude: canonicalLongitude(points[0]!.longitude), latitude: points[0]!.latitude }],
    ];
  }

  const unwrapped = unwrapPolylineRelativeToCenter(points, centerLongitude);
  const runs: LonLat[][] = [];
  let current: LonLat[] = [
    { longitude: canonicalLongitude(unwrapped[0]!.longitude), latitude: unwrapped[0]!.latitude },
  ];

  for (let index = 1; index < unwrapped.length; index += 1) {
    const start = unwrapped[index - 1]!;
    const end = unwrapped[index]!;
    const seam = seamBetween(start.longitude, end.longitude);

    if (seam !== null) {
      const fraction = (seam - start.longitude) / (end.longitude - start.longitude);
      const latitude = start.latitude + (end.latitude - start.latitude) * fraction;
      const headingEast = end.longitude > start.longitude;
      const leavingLongitude = headingEast ? HALF_PERIOD : -HALF_PERIOD;
      const enteringLongitude = -leavingLongitude;
      current.push({ longitude: leavingLongitude, latitude });
      runs.push(current);
      current = [{ longitude: enteringLongitude, latitude }];
    }

    current.push({ longitude: canonicalLongitude(end.longitude), latitude: end.latitude });
  }

  runs.push(current);
  return runs;
}
