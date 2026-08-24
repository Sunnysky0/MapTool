import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultMapDocument } from '../core/model/map-document';
import { PROJECT_STORAGE_KEY, useProjectStore } from './project-store';
import { useUiStore } from './ui-store';

function documentFixture() {
  return createDefaultMapDocument({
    file: 'source_map.svg',
    sha256: 'b'.repeat(64),
    calibration: {
      version: 1,
      method: 'artistic-plate-carree',
      xMin: 0,
      xMax: 100,
      yMin: 0,
      yMax: 50,
      longitudeRange: [-180, 180],
      latitudeRange: [-90, 90],
      yAxis: 'down',
    },
  });
}

beforeEach(() => {
  localStorage.clear();
  useProjectStore.getState().clearDocument();
  useUiStore.getState().resetUi();
});

describe('project and UI stores', () => {
  it('updates project state only through named actions and persists only the document', () => {
    const document = documentFixture();
    useProjectStore.getState().setDocument(document);
    useProjectStore.getState().setExtent({
      west: 170,
      east: -170,
      south: -20,
      north: 30,
      wrapsAntimeridian: true,
    });
    useProjectStore.getState().setProjectionParameter('centralMeridian', 180);

    expect(useProjectStore.getState().document?.extent.wrapsAntimeridian).toBe(true);
    expect(useProjectStore.getState().document?.projection.parameters.centralMeridian).toBe(180);
    const persisted = JSON.parse(localStorage.getItem(PROJECT_STORAGE_KEY) ?? '{}') as {
      state?: Record<string, unknown>;
    };
    expect(persisted.state).toEqual({ document: useProjectStore.getState().document });
  });

  it('keeps transient UI state in its separate non-persisted store', () => {
    const projectStorageBefore = localStorage.getItem(PROJECT_STORAGE_KEY);
    useUiStore.getState().setActiveTool('extent');
    useUiStore.getState().setDragging(true);
    useUiStore.getState().setPreviewQuality('interactive');
    expect(useUiStore.getState()).toMatchObject({
      activeTool: 'extent',
      dragging: true,
      previewQuality: 'interactive',
    });
    expect(localStorage.getItem(PROJECT_STORAGE_KEY)).toBe(projectStorageBefore);
  });

  it('validates replacements and field actions atomically before changing current state', () => {
    const document = documentFixture();
    useProjectStore.getState().setDocument(document);
    expect(() =>
      useProjectStore.getState().setDocument({
        ...document,
        canvas: { ...document.canvas, width: 0 },
      }),
    ).toThrow();
    expect(() =>
      useProjectStore.getState().setExtent({
        west: -10,
        east: 10,
        south: 20,
        north: 10,
        wrapsAntimeridian: false,
      }),
    ).toThrow();
    expect(useProjectStore.getState().document).toEqual(document);
  });
});
