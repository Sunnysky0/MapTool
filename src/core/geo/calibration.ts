import type { CalibrationSnapshot } from '../../types/source-map';

export interface SvgPoint {
  x: number;
  y: number;
}

export interface GeographicPoint {
  longitude: number;
  latitude: number;
}

const CALIBRATION_VERSION = 1;
const CALIBRATION_METHOD = 'artistic-plate-carree';
const LONGITUDE_RANGE = [-180, 180] as const;
const LATITUDE_RANGE = [-90, 90] as const;

function requireFinite(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number.`);
  }
  return value;
}

export function assertCalibrationSnapshot(
  calibration: CalibrationSnapshot,
): asserts calibration is CalibrationSnapshot {
  if (calibration.version !== CALIBRATION_VERSION) {
    throw new Error(`Unsupported source-map calibration version: ${String(calibration.version)}.`);
  }
  if (calibration.method !== CALIBRATION_METHOD) {
    throw new Error(`Unsupported source-map calibration method: ${String(calibration.method)}.`);
  }
  if (calibration.yAxis !== 'down') {
    throw new Error(`Unsupported source-map Y axis: ${String(calibration.yAxis)}.`);
  }
  if (
    calibration.longitudeRange[0] !== LONGITUDE_RANGE[0] ||
    calibration.longitudeRange[1] !== LONGITUDE_RANGE[1] ||
    calibration.latitudeRange[0] !== LATITUDE_RANGE[0] ||
    calibration.latitudeRange[1] !== LATITUDE_RANGE[1]
  ) {
    throw new Error('Unsupported source-map longitude or latitude range.');
  }

  const xMin = requireFinite(calibration.xMin, 'calibration.xMin');
  const xMax = requireFinite(calibration.xMax, 'calibration.xMax');
  const yMin = requireFinite(calibration.yMin, 'calibration.yMin');
  const yMax = requireFinite(calibration.yMax, 'calibration.yMax');
  if (!(xMax > xMin) || !(yMax > yMin)) {
    throw new Error('Source-map calibration bounds must have positive width and height.');
  }
}

export function svgToGeographic(
  point: SvgPoint,
  calibration: CalibrationSnapshot,
): GeographicPoint {
  assertCalibrationSnapshot(calibration);
  const x = requireFinite(point.x, 'point.x');
  const y = requireFinite(point.y, 'point.y');
  return {
    longitude: ((x - calibration.xMin) / (calibration.xMax - calibration.xMin)) * 360 - 180,
    latitude: 90 - ((y - calibration.yMin) / (calibration.yMax - calibration.yMin)) * 180,
  };
}

export function geographicToSvg(
  point: GeographicPoint,
  calibration: CalibrationSnapshot,
): SvgPoint {
  assertCalibrationSnapshot(calibration);
  const longitude = requireFinite(point.longitude, 'point.longitude');
  const latitude = requireFinite(point.latitude, 'point.latitude');
  return {
    x: calibration.xMin + ((longitude + 180) / 360) * (calibration.xMax - calibration.xMin),
    y: calibration.yMin + ((90 - latitude) / 180) * (calibration.yMax - calibration.yMin),
  };
}
