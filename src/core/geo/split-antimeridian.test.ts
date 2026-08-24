import { describe, expect, it } from 'vitest';
import { splitAntimeridian, unwrapPolylineRelativeToCenter } from './split-antimeridian';

describe('antimeridian handling', () => {
  it('unwraps connected points relative to a wrapped selection center', () => {
    expect(
      unwrapPolylineRelativeToCenter(
        [
          { longitude: 175, latitude: 0 },
          { longitude: -175, latitude: 5 },
          { longitude: -160, latitude: 10 },
        ],
        -175,
      ),
    ).toEqual([
      { longitude: -185, latitude: 0 },
      { longitude: -175, latitude: 5 },
      { longitude: -160, latitude: 10 },
    ]);
  });

  it('leaves ordinary and seam-bound linework as one run', () => {
    const line = [
      { longitude: -20, latitude: 0 },
      { longitude: 10, latitude: 5 },
      { longitude: 40, latitude: 0 },
    ];
    expect(splitAntimeridian(line)).toEqual([line]);
    expect(
      splitAntimeridian([
        { longitude: 170, latitude: 0 },
        { longitude: 180, latitude: 5 },
      ]),
    ).toEqual([
      [
        { longitude: 170, latitude: 0 },
        { longitude: 180, latitude: 5 },
      ],
    ]);
  });

  it('splits eastbound and westbound crossings with interpolated seam latitude', () => {
    expect(
      splitAntimeridian([
        { longitude: 170, latitude: 0 },
        { longitude: -170, latitude: 20 },
      ]),
    ).toEqual([
      [
        { longitude: 170, latitude: 0 },
        { longitude: 180, latitude: 10 },
      ],
      [
        { longitude: -180, latitude: 10 },
        { longitude: -170, latitude: 20 },
      ],
    ]);

    expect(
      splitAntimeridian([
        { longitude: -170, latitude: 20 },
        { longitude: 170, latitude: 0 },
      ]),
    ).toEqual([
      [
        { longitude: -170, latitude: 20 },
        { longitude: -180, latitude: 10 },
      ],
      [
        { longitude: 180, latitude: 10 },
        { longitude: 170, latitude: 0 },
      ],
    ]);
  });
});
