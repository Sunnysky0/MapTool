import { MathUtils, Ray, Sphere, Vector3 } from 'three';

export interface GeographicExtent {
  west: number;
  east: number;
  south: number;
  north: number;
}

export interface LonLat {
  longitude: number;
  latitude: number;
}

export const GLOBE_RADIUS = 1;
export const LINE_RADIUS = 1.003;
export const OVERLAY_RADIUS = 1.009;

export function clampLatitude(latitude: number): number {
  return MathUtils.clamp(latitude, -90, 90);
}

export function normalizeLongitude(longitude: number): number {
  const normalized = ((((longitude + 180) % 360) + 360) % 360) - 180;
  return normalized === -180 && longitude > 0 ? 180 : normalized;
}

export function longitudeSpan(west: number, east: number): number {
  const rawSpan = east - west;
  if (Math.abs(rawSpan) >= 360) return 360;
  return ((rawSpan % 360) + 360) % 360;
}

export function extentWraps(extent: GeographicExtent): boolean {
  const span = longitudeSpan(extent.west, extent.east);
  return span > 0 && normalizeLongitude(extent.east) < normalizeLongitude(extent.west);
}

export function lonLatToVector3(longitude: number, latitude: number, radius = 1): Vector3 {
  const longitudeRadians = MathUtils.degToRad(longitude);
  const latitudeRadians = MathUtils.degToRad(clampLatitude(latitude));
  const latitudeRadius = Math.cos(latitudeRadians) * radius;

  return new Vector3(
    latitudeRadius * Math.sin(longitudeRadians),
    Math.sin(latitudeRadians) * radius,
    latitudeRadius * Math.cos(longitudeRadians),
  );
}

export function vector3ToLonLat(point: Vector3): LonLat {
  const normalized = point.clone().normalize();
  return {
    longitude: normalizeLongitude(MathUtils.radToDeg(Math.atan2(normalized.x, normalized.z))),
    latitude: MathUtils.radToDeg(Math.asin(MathUtils.clamp(normalized.y, -1, 1))),
  };
}

export function intersectRayWithGlobe(ray: Ray, radius = GLOBE_RADIUS): LonLat | null {
  const hit = ray.intersectSphere(new Sphere(new Vector3(), radius), new Vector3());
  return hit ? vector3ToLonLat(hit) : null;
}

export function angularDistanceDegrees(start: LonLat, end: LonLat): number {
  const a = lonLatToVector3(start.longitude, start.latitude);
  const b = lonLatToVector3(end.longitude, end.latitude);
  return MathUtils.radToDeg(Math.acos(MathUtils.clamp(a.dot(b), -1, 1)));
}

export function interpolateGreatCircle(start: LonLat, end: LonLat, t: number): LonLat {
  const a = lonLatToVector3(start.longitude, start.latitude);
  const b = lonLatToVector3(end.longitude, end.latitude);
  const dot = MathUtils.clamp(a.dot(b), -1, 1);
  const angle = Math.acos(dot);

  if (angle < 1e-7) {
    return {
      longitude: start.longitude + (end.longitude - start.longitude) * t,
      latitude: start.latitude + (end.latitude - start.latitude) * t,
    };
  }

  const sinAngle = Math.sin(angle);
  const point = a
    .multiplyScalar(Math.sin((1 - t) * angle) / sinAngle)
    .add(b.multiplyScalar(Math.sin(t * angle) / sinAngle))
    .normalize();
  return vector3ToLonLat(point);
}

export function splitLongitudeIntervals(
  extent: GeographicExtent,
): Array<readonly [number, number]> {
  const west = normalizeLongitude(extent.west);
  const span = longitudeSpan(extent.west, extent.east);
  if (span >= 360 || Math.abs(extent.east - extent.west) >= 360) return [[-180, 180]];
  if (span === 0) return [[west, west]];

  const unwrappedEast = west + span;
  if (unwrappedEast <= 180) return [[west, unwrappedEast]];
  return [
    [west, 180],
    [-180, unwrappedEast - 360],
  ];
}
