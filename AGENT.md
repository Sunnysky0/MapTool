# AGENT.md

## Purpose

Meridian is a browser-based map-art creation tool. It lets users compose projected maps from geographic layers, tune their visual style, and export the finished artwork as PNG, SVG, or a reusable JSON style file.

The application is intentionally client-only. Geographic source data is loaded in the browser and artwork is rendered locally; do not introduce a server dependency unless the task explicitly requires one.

## Stack And Commands

- React 19 with TypeScript and Vite.
- Tailwind CSS v4 for component styling, with a small set of global rules in `src/index.css`.
- D3 Geo and D3 Geo Projection for projections and path generation.
- TopoJSON and `world-atlas` for geographic data.
- Lucide React for interface icons.

```sh
npm run dev
npm run build
npm run preview
```

Run `npm run build` after code changes. This is the current production and TypeScript validation command; the repository does not presently include separate lint or test scripts.

## Source Layout

- `src/App.tsx`: application orchestration, keyboard shortcuts, local persistence, panels, and canvas composition.
- `src/types.ts`: central domain model. Keep additions to map state typed here.
- `src/components/`: UI panels, shared controls, toolbar, and `MapCanvas`.
- `src/hooks/useHistory.ts`: undo/redo with grouped transient changes.
- `src/hooks/useLayerData.ts`: loads data needed by visible layers and exposes retry state.
- `src/lib/presets.ts`: defaults, themes, location presets, export sizes, and configuration version.
- `src/lib/data.ts`: layer catalog, remote source loading, TopoJSON conversion, and in-memory request cache.
- `src/lib/projections.ts`: supported projection catalog and view-to-projection construction.
- `src/lib/view.ts`: bounded pan, zoom, and rotation behavior.
- `src/lib/render.ts`: canonical Canvas and SVG renderer.

## Map Model And State

- `MapConfig` is the complete persisted and exported artwork document. Add user-configurable map state to `src/types.ts` and initialize it in `defaultConfig()`.
- Increment `CONFIG_VERSION` when persisted configuration changes incompatibly. `App.tsx` restores only matching versions from `localStorage` under `meridian-map-config`.
- Keep updates immutable. Component callbacks receive either `update(fn, transient?)` or `replace(config)` from `App`.
- Mark high-frequency drag updates as transient and call `commit()` when the interaction ends. This keeps one drag as one undo entry.
- Configuration import merges onto `defaultConfig()`; ensure new nested defaults are covered by that merge strategy.

## Data And Rendering Invariants

- Only request remote geographic data for visible layers. `layerDataKey()` defines the cache key and `useLayerData()` determines what is required.
- Preserve the existing source fallback behavior in `fetchJSON()`. Layer data must remain usable when one CDN is unavailable.
- Add a layer consistently: extend `LayerId` and `LayerStyle`, add its default, register `LAYER_DEFS`, implement its data key/loading behavior if needed, and render it in `PAINT_ORDER`.
- `drawMap()` and `renderSVG()` are the two export paths. Any visual feature that should survive export must be implemented in both, using the same layer order, projection, geometry selection, and sizing rules.
- Line widths are defined against a 1920px-wide artboard and scaled by `width / 1920`. Preserve this rule so previews and exports remain visually consistent.
- Keep geographic coordinates in longitude/latitude order: `[lon, lat]`.
- Globe-like projections hide points behind the horizon through `visiblePoint()`. Maintain equivalent clipping behavior for new point-based rendering.

## UI Conventions

- Match the existing compact dark editor UI: Tailwind utility classes, zinc surfaces, amber accents, and small control labels.
- Use `lucide-react` icons for icon buttons and provide a `title` for controls whose purpose is not visible as text.
- Reuse primitives from `src/components/ui.tsx` for panel controls before adding a new control pattern.
- Keep the canvas responsive. `MapCanvas` reports its CSS-pixel size to `App`, which is used for keyboard navigation and projection math.
- Avoid changing keyboard shortcuts without updating the corresponding button titles and preserving input-field focus behavior.

## Scope And Safety

- Do not commit `node_modules`, generated `dist` output, local environment files, or editor-specific files ignored by `.gitignore`.
- Do not alter third-party CDN sources casually; these directly affect layer availability and exported artwork.
- Keep changes focused. The app has no backend, authentication, or build-time asset pipeline.
