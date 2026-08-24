export interface LonLat {
  longitude: number;
  latitude: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Ray {
  origin: Vec3;
  direction: Vec3;
}

const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;
const VECTOR_EPSILON = 1e-12;

export function normalizeLongitude(longitude: number): number {
  if (!Number.isFinite(longitude)) return Number.NaN;
  const normalized = ((((longitude + 180) % 360) + 360) % 360) - 180;
  // Preserve positive antimeridian when it is explicitly supplied or reached
  // from a positive revolution. This avoids turning the full-world east edge
  // into its west edge while keeping all other values canonical.
  return normalized === -180 && longitude > 0 ? 180 : normalized;
}

export function clampLatitude(latitude: number): number {
  return Math.min(90, Math.max(-90, latitude));
}

export function normalizeRadians(angle: number): number {
  if (!Number.isFinite(angle)) return Number.NaN;
  return ((((angle + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
}

export function normalizeVector(vector: Vec3): Vec3 | null {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(length) || length <= VECTOR_EPSILON) return null;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

/**
 * Converts longitude/latitude degrees to a Y-up sphere. Longitude zero points
 * along +X, east rotates toward +Z, and the north pole points along +Y.
 */
export function lonLatToXyz(lonLat: LonLat, radius = 1): Vec3 {
  if (
    !Number.isFinite(lonLat.longitude) ||
    !Number.isFinite(lonLat.latitude) ||
    !Number.isFinite(radius) ||
    radius < 0
  ) {
    throw new RangeError(
      'Longitude, latitude, and radius must be finite; radius must be non-negative.',
    );
  }
  if (lonLat.latitude < -90 || lonLat.latitude > 90) {
    throw new RangeError('Latitude must be between -90 and 90 degrees.');
  }

  const longitude = lonLat.longitude * DEGREES_TO_RADIANS;
  const latitude = lonLat.latitude * DEGREES_TO_RADIANS;
  const radial = Math.cos(latitude) * radius;
  return {
    x: radial * Math.cos(longitude),
    y: radius * Math.sin(latitude),
    z: radial * Math.sin(longitude),
  };
}

export function xyzToLonLat(vector: Vec3): LonLat | null {
  const unit = normalizeVector(vector);
  if (!unit) return null;
  return {
    longitude: normalizeLongitude(Math.atan2(unit.z, unit.x) * RADIANS_TO_DEGREES),
    latitude: Math.asin(Math.min(1, Math.max(-1, unit.y))) * RADIANS_TO_DEGREES,
  };
}

/** Returns the nearest non-negative ray intersection, or null for a miss. */
export function intersectRaySphere(
  ray: Ray,
  radius = 1,
  center: Vec3 = { x: 0, y: 0, z: 0 },
): Vec3 | null {
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new RangeError('Sphere radius must be finite and greater than zero.');
  }
  const direction = normalizeVector(ray.direction);
  if (!direction) return null;

  const offset = {
    x: ray.origin.x - center.x,
    y: ray.origin.y - center.y,
    z: ray.origin.z - center.z,
  };
  const projection = offset.x * direction.x + offset.y * direction.y + offset.z * direction.z;
  const constant =
    offset.x * offset.x + offset.y * offset.y + offset.z * offset.z - radius * radius;
  const discriminant = projection * projection - constant;
  if (discriminant < -VECTOR_EPSILON) return null;

  const root = Math.sqrt(Math.max(0, discriminant));
  const near = -projection - root;
  const far = -projection + root;
  const distance = near >= 0 ? near : far >= 0 ? far : null;
  if (distance === null) return null;

  return {
    x: ray.origin.x + direction.x * distance,
    y: ray.origin.y + direction.y * distance,
    z: ray.origin.z + direction.z * distance,
  };
}

function sampleRange(start: number, end: number, segments: number): number[] {
  if (!Number.isInteger(segments) || segments < 1) {
    throw new RangeError('segments must be a positive integer.');
  }
  return Array.from({ length: segments + 1 }, (_, index) =>
    index === segments ? end : start + ((end - start) * index) / segments,
  );
}

export function sampleMeridian(
  longitude: number,
  south: number,
  north: number,
  segments: number,
): LonLat[] {
  if (south < -90 || north > 90 || south > north) {
    throw new RangeError('Meridian latitude range must satisfy -90 <= south <= north <= 90.');
  }
  return sampleRange(south, north, segments).map((latitude) => ({ longitude, latitude }));
}

/**
 * Samples an eastward parallel. Pass an unwrapped east value (for example 190)
 * when traversing across the antimeridian; output longitudes remain unwrapped
 * so callers can split at the seam without losing continuity.
 */
export function sampleParallel(
  latitude: number,
  west: number,
  east: number,
  segments: number,
): LonLat[] {
  if (latitude < -90 || latitude > 90 || east < west) {
    throw new RangeError('Parallel range requires a valid latitude and east >= west.');
  }
  return sampleRange(west, east, segments).map((longitude) => ({ longitude, latitude }));
}
