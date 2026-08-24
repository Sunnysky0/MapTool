import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type {
  CanvasSettings,
  GeographicExtent,
  MapDocument,
  MapStyle,
  ProjectionSettings,
} from '../core/model/map-document';
import { mapDocumentSchema } from '../core/project/schema';

export const PROJECT_STORAGE_KEY = 'maptool-project-v1';

export interface ProjectStoreState {
  document: MapDocument | null;
  setDocument(document: MapDocument): void;
  clearDocument(): void;
  setExtent(extent: GeographicExtent): void;
  setProjection(projection: ProjectionSettings): void;
  setProjectionParameter(name: string, value: number | boolean | string): void;
  setCanvas(canvas: CanvasSettings): void;
  setStyle(style: MapStyle): void;
  setExportQuality(quality: MapDocument['exportQuality']): void;
}

function updateDocument(
  state: ProjectStoreState,
  update: (document: MapDocument) => MapDocument,
): Pick<ProjectStoreState, 'document'> {
  if (!state.document) return { document: null };
  return { document: mapDocumentSchema.parse(update(state.document)) };
}

export const useProjectStore = create<ProjectStoreState>()(
  persist(
    (set) => ({
      document: null,
      setDocument: (document) => set({ document: mapDocumentSchema.parse(document) }),
      clearDocument: () => set({ document: null }),
      setExtent: (extent) =>
        set((state) => updateDocument(state, (document) => ({ ...document, extent }))),
      setProjection: (projection) =>
        set((state) => updateDocument(state, (document) => ({ ...document, projection }))),
      setProjectionParameter: (name, value) =>
        set((state) =>
          updateDocument(state, (document) => ({
            ...document,
            projection: {
              ...document.projection,
              parameters: { ...document.projection.parameters, [name]: value },
            },
          })),
        ),
      setCanvas: (canvas) =>
        set((state) => updateDocument(state, (document) => ({ ...document, canvas }))),
      setStyle: (style) =>
        set((state) => updateDocument(state, (document) => ({ ...document, style }))),
      setExportQuality: (exportQuality) =>
        set((state) => updateDocument(state, (document) => ({ ...document, exportQuality }))),
    }),
    {
      name: PROJECT_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ document: state.document }),
      merge: (persisted, current) => {
        const candidate = (persisted as Partial<ProjectStoreState> | undefined)?.document;
        const parsed = mapDocumentSchema.safeParse(candidate);
        return { ...current, document: parsed.success ? parsed.data : current.document };
      },
    },
  ),
);
