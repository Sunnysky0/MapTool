import { describe, expect, it, vi } from 'vitest';
import { createDefaultMapDocument, type SourceReference } from '../model/map-document';
import { projectBlob } from './downloadProject';
import { loadProject } from './loadProject';
import { ProjectValidationError } from './serialization';

const source: SourceReference = {
  file: 'source_map.svg',
  sha256: 'a'.repeat(64),
  calibration: {
    version: 1,
    method: 'artistic-plate-carree',
    xMin: 0,
    xMax: 360,
    yMin: 0,
    yMax: 180,
    longitudeRange: [-180, 180],
    latitudeRange: [-90, 90],
    yAxis: 'down',
  },
};

describe('project download and load', () => {
  it('writes formatted versioned JSON and loads it with one replacement', async () => {
    const document = createDefaultMapDocument(source);
    const blob = projectBlob(document);
    const replaceProject = vi.fn();

    expect(blob.type).toBe('application/json;charset=utf-8');
    const text = await blob.text();
    expect(text).toContain('\n  "schemaVersion": 1,\n');
    expect(text.endsWith('\n')).toBe(true);

    const loaded = await loadProject({ text: async () => text }, replaceProject);
    expect(loaded).toEqual(document);
    expect(replaceProject).toHaveBeenCalledOnce();
    expect(replaceProject).toHaveBeenCalledWith(document);
  });

  it('returns field errors and performs no partial replacement for invalid data', async () => {
    const document = createDefaultMapDocument(source);
    const decoded = JSON.parse(await projectBlob(document).text()) as Record<string, unknown>;
    decoded.unknown = true;
    const replaceProject = vi.fn();

    await expect(
      loadProject({ text: async () => JSON.stringify(decoded) }, replaceProject),
    ).rejects.toMatchObject({
      name: 'ProjectValidationError',
      fieldErrors: expect.arrayContaining([expect.objectContaining({ path: '$' })]),
    } satisfies Partial<ProjectValidationError>);
    expect(replaceProject).not.toHaveBeenCalled();
  });

  it('performs no replacement when reading the file fails', async () => {
    const replaceProject = vi.fn();
    const readFailure = new Error('read failed');

    await expect(
      loadProject(
        {
          text: async () => {
            throw readFailure;
          },
        },
        replaceProject,
      ),
    ).rejects.toBe(readFailure);
    expect(replaceProject).not.toHaveBeenCalled();
  });
});
