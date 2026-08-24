import type { GeographicExtent } from '../model/map-document';
import { containsLonLat, validateExtent } from '../geo/extent';
import type {
  GeographicPosition,
  ProjectionId,
  ProjectionValidationIssue,
  ProjectionValidationResult,
} from './types';

export const WEB_MERCATOR_MAX_LATITUDE = 85.05112878;
const ANTIPODE_EPSILON = 1e-9;

function normalizeLongitude(longitude: number): number {
  const normalized = ((((longitude + 180) % 360) + 360) % 360) - 180;
  return normalized === -180 && longitude > 0 ? 180 : normalized;
}

export function antipodeOf(center: GeographicPosition): [number, number] {
  const antipodeLatitude = -center[1];
  return [
    normalizeLongitude(center[0] + 180),
    Object.is(antipodeLatitude, -0) ? 0 : antipodeLatitude,
  ];
}

export function validateProjection(
  id: ProjectionId,
  extent: GeographicExtent,
  center: GeographicPosition,
): ProjectionValidationResult {
  const issues: ProjectionValidationIssue[] = validateExtent(extent).map((issue) => ({
    code: 'invalid-extent',
    message: `${issue.field}: ${issue.message}`,
  }));

  if (
    !Number.isFinite(center[0]) ||
    !Number.isFinite(center[1]) ||
    center[1] < -90 ||
    center[1] > 90
  ) {
    issues.push({
      code: 'invalid-center',
      message: '投影中心必须是有效的经纬度。',
      position: center,
    });
  }

  if (
    id === 'mercator' &&
    Number.isFinite(extent.south) &&
    Number.isFinite(extent.north) &&
    (extent.south < -WEB_MERCATOR_MAX_LATITUDE || extent.north > WEB_MERCATOR_MAX_LATITUDE)
  ) {
    issues.push({
      code: 'mercator-latitude-domain',
      message: `墨卡托投影仅支持纬度 ±${WEB_MERCATOR_MAX_LATITUDE}° 以内；所选范围不会被自动裁剪。`,
    });
  }

  if (id === 'lambert-azimuthal-equal-area' && issues.length === 0) {
    const antipode = antipodeOf(center);
    if (containsLonLat(extent, antipode[0], antipode[1], ANTIPODE_EPSILON)) {
      issues.push({
        code: 'lambert-antipode-singularity',
        message: '所选范围包含投影中心的球面反极点，兰伯特方位等积投影在此处不可定义。',
        position: antipode,
      });
    }
  }

  return { valid: issues.length === 0, issues };
}

export function assertProjectionValid(
  id: ProjectionId,
  extent: GeographicExtent,
  center: GeographicPosition,
): void {
  const result = validateProjection(id, extent, center);
  if (!result.valid) {
    throw new RangeError(
      result.issues.map((issue) => `${issue.code}: ${issue.message}`).join('; '),
    );
  }
}
