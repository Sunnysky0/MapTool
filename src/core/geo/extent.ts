import type { GeographicExtent } from '../model/map-document';

export const MIN_LONGITUDE = -180;
export const MAX_LONGITUDE = 180;
export const MIN_LATITUDE = -90;
export const MAX_LATITUDE = 90;

export interface ExtentValidationIssue {
  field: keyof GeographicExtent;
  message: string;
}

export interface LongitudeWindow {
  west: number;
  east: number;
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

/**
 * Validates the canonical extent representation.
 *
 * A non-wrapped extent has west <= east. A wrapped extent has west > east and
 * selects [west, 180] U [-180, east]. The full world is the one explicit
 * non-wrapped interval [-180, 180]; zero-width and 360-degree wrapped aliases
 * are rejected.
 */
export function validateExtent(extent: GeographicExtent): ExtentValidationIssue[] {
  const issues: ExtentValidationIssue[] = [];
  const longitudeFields = ['west', 'east'] as const;
  const latitudeFields = ['south', 'north'] as const;

  for (const field of longitudeFields) {
    const value = extent[field];
    if (!isFiniteNumber(value)) {
      issues.push({ field, message: `${field} must be finite.` });
    } else if (value < MIN_LONGITUDE || value > MAX_LONGITUDE) {
      issues.push({ field, message: `${field} must be between -180 and 180 degrees.` });
    }
  }

  for (const field of latitudeFields) {
    const value = extent[field];
    if (!isFiniteNumber(value)) {
      issues.push({ field, message: `${field} must be finite.` });
    } else if (value < MIN_LATITUDE || value > MAX_LATITUDE) {
      issues.push({ field, message: `${field} must be between -90 and 90 degrees.` });
    }
  }

  if (
    isFiniteNumber(extent.south) &&
    isFiniteNumber(extent.north) &&
    extent.south >= extent.north
  ) {
    issues.push({ field: 'north', message: 'north must be greater than south.' });
  }

  if (isFiniteNumber(extent.west) && isFiniteNumber(extent.east)) {
    if (extent.wrapsAntimeridian) {
      if (extent.west <= extent.east) {
        issues.push({
          field: 'wrapsAntimeridian',
          message: 'A wrapped extent must have west greater than east.',
        });
      }
    } else if (extent.west >= extent.east) {
      issues.push({
        field: 'east',
        message: 'A non-wrapped extent must have east greater than west.',
      });
    }
  }

  return issues;
}

export function isValidExtent(extent: GeographicExtent): boolean {
  return validateExtent(extent).length === 0;
}

export function assertValidExtent(extent: GeographicExtent): void {
  const issues = validateExtent(extent);
  if (issues.length > 0) {
    throw new RangeError(issues.map((issue) => `${issue.field}: ${issue.message}`).join('; '));
  }
}

export function longitudeSpan(extent: GeographicExtent): number {
  assertValidExtent(extent);
  return extent.wrapsAntimeridian
    ? MAX_LONGITUDE - extent.west + (extent.east - MIN_LONGITUDE)
    : extent.east - extent.west;
}

/** Center longitude returned in canonical [-180, 180]. */
export function extentCenterLongitude(extent: GeographicExtent): number {
  const center = extent.west + longitudeSpan(extent) / 2;
  return center > MAX_LONGITUDE ? center - 360 : center;
}

export function extentCenterLatitude(extent: GeographicExtent): number {
  assertValidExtent(extent);
  return (extent.south + extent.north) / 2;
}

/** Returns one or two canonical, non-wrapped windows. */
export function extentLongitudeWindows(extent: GeographicExtent): LongitudeWindow[] {
  assertValidExtent(extent);
  if (!extent.wrapsAntimeridian) return [{ west: extent.west, east: extent.east }];
  return [
    { west: extent.west, east: MAX_LONGITUDE },
    { west: MIN_LONGITUDE, east: extent.east },
  ];
}

export function containsLonLat(
  extent: GeographicExtent,
  longitude: number,
  latitude: number,
  epsilon = 1e-10,
): boolean {
  assertValidExtent(extent);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return false;
  if (latitude < extent.south - epsilon || latitude > extent.north + epsilon) return false;
  const longitudeInside = extent.wrapsAntimeridian
    ? longitude >= extent.west - epsilon || longitude <= extent.east + epsilon
    : longitude >= extent.west - epsilon && longitude <= extent.east + epsilon;
  return (
    longitude >= MIN_LONGITUDE - epsilon && longitude <= MAX_LONGITUDE + epsilon && longitudeInside
  );
}
