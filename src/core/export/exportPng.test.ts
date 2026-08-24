import { describe, expect, it } from 'vitest';
import { MAX_PNG_AXIS, MAX_PNG_BYTES, PngExportError, validatePngDimensions } from './exportPng';

describe('validatePngDimensions', () => {
  it('accepts the inclusive axis and memory limits', () => {
    expect(() => validatePngDimensions(MAX_PNG_AXIS, MAX_PNG_AXIS)).not.toThrow();
    expect(MAX_PNG_AXIS * MAX_PNG_AXIS * 4).toBe(MAX_PNG_BYTES);
  });

  it.each([
    [0, 10],
    [10, -1],
    [10.5, 10],
    [Number.NaN, 10],
    [Number.POSITIVE_INFINITY, 10],
  ])('rejects invalid dimensions %s × %s', (width, height) => {
    expect(() => validatePngDimensions(width, height)).toThrow(PngExportError);
  });

  it('validates each axis before allocating a canvas', () => {
    expect(() => validatePngDimensions(MAX_PNG_AXIS + 1, 1)).toThrow(/per-axis limit/);
    expect(() => validatePngDimensions(1, MAX_PNG_AXIS + 1)).toThrow(/per-axis limit/);
  });

  it('rejects memory above 256 MiB as well as oversized axes', () => {
    expect(() => validatePngDimensions(MAX_PNG_AXIS, MAX_PNG_AXIS)).not.toThrow();
    expect(() => validatePngDimensions(MAX_PNG_AXIS, MAX_PNG_AXIS + 1)).toThrow(/256 MiB/);
  });
});
