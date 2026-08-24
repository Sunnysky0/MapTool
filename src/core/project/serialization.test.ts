import { describe, expect, it } from 'vitest';
import { createDefaultMapDocument } from '../model/map-document';
import { deserializeProject, ProjectValidationError, serializeProject } from './serialization';

function documentFixture() {
  return createDefaultMapDocument({
    file: 'source_map.svg',
    sha256: 'a'.repeat(64),
    calibration: {
      version: 1,
      method: 'artistic-plate-carree',
      xMin: 10,
      xMax: 1010,
      yMin: 20,
      yMax: 520,
      longitudeRange: [-180, 180],
      latitudeRange: [-90, 90],
      yAxis: 'down',
    },
  });
}

describe('project serialization', () => {
  it('round-trips a strict schema version 1 document', () => {
    const document = documentFixture();
    const serialized = serializeProject(document);
    expect(JSON.parse(serialized)).toMatchObject({ schemaVersion: 1, document });
    expect(deserializeProject(serialized)).toEqual(document);
  });

  it('rejects unknown fields and reports their precise path', () => {
    const file = JSON.parse(serializeProject(documentFixture())) as Record<string, unknown>;
    const document = file.document as Record<string, unknown>;
    document.renderCache = { stale: true };
    expect(() => deserializeProject(JSON.stringify(file))).toThrowError(ProjectValidationError);
    try {
      deserializeProject(JSON.stringify(file));
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectValidationError);
      expect((error as ProjectValidationError).fieldErrors).toContainEqual({
        path: 'document',
        message: expect.stringContaining('renderCache'),
      });
    }
  });

  it('reports useful nested field errors rather than partially accepting data', () => {
    const file = JSON.parse(serializeProject(documentFixture())) as {
      document: { extent: { north: number }; canvas: { width: number } };
    };
    file.document.extent.north = -90;
    file.document.canvas.width = 0;
    try {
      deserializeProject(JSON.stringify(file));
      expect.unreachable('Expected invalid project to be rejected.');
    } catch (error) {
      const validationError = error as ProjectValidationError;
      expect(validationError.fieldErrors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'document.extent.north' }),
          expect.objectContaining({ path: 'document.canvas.width' }),
        ]),
      );
    }
  });

  it('rejects malformed JSON and unsupported or missing schema versions', () => {
    expect(() => deserializeProject('{ nope')).toThrowError(/malformed/);
    expect(() =>
      deserializeProject(JSON.stringify({ schemaVersion: 2, document: documentFixture() })),
    ).toThrowError(/Unsupported project schemaVersion 2/);
    expect(() => deserializeProject(JSON.stringify({ document: documentFixture() }))).toThrowError(
      /schemaVersion/,
    );
  });
});
