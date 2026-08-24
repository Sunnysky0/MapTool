import { describe, expect, it } from 'vitest';

import type { CalibrationSnapshot } from '../../types/source-map';
import { assertCalibrationSnapshot, geographicToSvg, svgToGeographic } from './calibration';

const calibration: CalibrationSnapshot = {
  version: 1,
  method: 'artistic-plate-carree',
  xMin: -28.9472,
  xMax: 2723.1798,
  yMin: 61.9866,
  yMax: 1457.5605,
  longitudeRange: [-180, 180],
  latitudeRange: [-90, 90],
  yAxis: 'down',
};

describe('source-map calibration', () => {
  it('maps the ocean frame corners and midpoint to the expected coordinates', () => {
    expect(svgToGeographic({ x: calibration.xMin, y: calibration.yMin }, calibration)).toEqual({
      longitude: -180,
      latitude: 90,
    });
    expect(svgToGeographic({ x: calibration.xMax, y: calibration.yMax }, calibration)).toEqual({
      longitude: 180,
      latitude: -90,
    });
    expect(
      svgToGeographic(
        {
          x: (calibration.xMin + calibration.xMax) / 2,
          y: (calibration.yMin + calibration.yMax) / 2,
        },
        calibration,
      ),
    ).toEqual({ longitude: 0, latitude: 0 });
  });

  it('round-trips SVG and geographic coordinates', () => {
    const points = [
      { x: -28.9472, y: 61.9866 },
      { x: 1234.5678, y: 765.4321 },
      { x: 2723.1798, y: 1457.5605 },
    ];

    for (const point of points) {
      const roundTrip = geographicToSvg(svgToGeographic(point, calibration), calibration);
      expect(roundTrip.x).toBeCloseTo(point.x, 10);
      expect(roundTrip.y).toBeCloseTo(point.y, 10);
    }
  });

  it('rejects non-finite values and unsupported calibration snapshots', () => {
    expect(() => svgToGeographic({ x: Number.NaN, y: 0 }, calibration)).toThrow(/finite/);
    expect(() => geographicToSvg({ longitude: 0, latitude: Infinity }, calibration)).toThrow(
      /finite/,
    );
    expect(() =>
      assertCalibrationSnapshot({ ...calibration, version: 2 } as unknown as CalibrationSnapshot),
    ).toThrow(/version/);
    expect(() => assertCalibrationSnapshot({ ...calibration, xMax: calibration.xMin })).toThrow(
      /positive width/,
    );
  });
});
