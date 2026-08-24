import { create } from 'zustand';

export type ActiveTool = 'orbit' | 'extent';
export type PreviewQuality = 'interactive' | 'full';

export interface UiStoreState {
  inspectorOpen: boolean;
  previewOpen: boolean;
  activeTool: ActiveTool;
  dragging: boolean;
  previewQuality: PreviewQuality;
  setInspectorOpen(open: boolean): void;
  setPreviewOpen(open: boolean): void;
  setActiveTool(tool: ActiveTool): void;
  setDragging(dragging: boolean): void;
  setPreviewQuality(quality: PreviewQuality): void;
  resetUi(): void;
}

const initialUiState = {
  inspectorOpen: true,
  previewOpen: true,
  activeTool: 'orbit' as ActiveTool,
  dragging: false,
  previewQuality: 'full' as PreviewQuality,
};

/** Ephemeral UI state: deliberately not persisted into project JSON or storage. */
export const useUiStore = create<UiStoreState>((set) => ({
  ...initialUiState,
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  setPreviewOpen: (previewOpen) => set({ previewOpen }),
  setActiveTool: (activeTool) => set({ activeTool }),
  setDragging: (dragging) => set({ dragging }),
  setPreviewQuality: (previewQuality) => set({ previewQuality }),
  resetUi: () => set(initialUiState),
}));
