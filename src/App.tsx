import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Layers, Loader2, Palette, Redo2, Share2, SlidersHorizontal, Undo2, Map as MapIcon } from 'lucide-react';
import type { MapConfig, ViewState } from './types';
import { ATLAS_SHEETS, DEFAULT_VIEW, SCENARIO_VIEW, defaultConfig, hydrateConfig } from './lib/presets';
import ScenarioPanel from './components/ScenarioPanel';
import { describeKey } from './lib/data';
import { clampView, panView, rotateViewTo, zoomViewAt } from './lib/view';
import { useHistory } from './hooks/useHistory';
import { useLayerData } from './hooks/useLayerData';
import MapCanvas, { type InteractionMode } from './components/MapCanvas';
import Toolbar from './components/Toolbar';
import LayersPanel from './components/LayersPanel';
import StylePanel from './components/StylePanel';
import ViewPanel from './components/ViewPanel';
import ExportPanel from './components/ExportPanel';
import { cn } from './utils/cn';

type Tab = 'layers' | 'style' | 'view' | 'export';
const STORAGE_KEY = 'meridian-map-config';

function loadInitial(): MapConfig {
  const base = defaultConfig();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<MapConfig>;
    return hydrateConfig(parsed);
  } catch {
    return base;
  }
}

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'layers', label: 'Layers', icon: Layers },
  { id: 'style', label: 'Style', icon: Palette },
  { id: 'view', label: 'View', icon: SlidersHorizontal },
  { id: 'export', label: 'Export', icon: Download },
];

export default function App() {
  const history = useHistory<MapConfig>(loadInitial);
  const config = history.state;
  const { data, loading, errors, retry } = useLayerData(config);
  const [tab, setTab] = useState<Tab>('layers');
  const [mode, setMode] = useState<InteractionMode>('pan');
  const sizeRef = useRef({ w: 1920, h: 1080 });
  const [toast, setToast] = useState<string | null>(null);

  const update = useCallback((fn: (c: MapConfig) => MapConfig, transient = false) => history.set(fn, transient), [history.set]);
  const replace = useCallback((c: MapConfig) => history.set(c), [history.set]);
  const commit = history.commit;

  // Persist
  useEffect(() => {
    const persist = () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(history.stateRef.current));
      } catch {
        /* ignore quota */
      }
    };
    const t = window.setTimeout(persist,400);
    window.addEventListener('pagehide',persist);
    return () => { window.clearTimeout(t);window.removeEventListener('pagehide',persist); };
  }, [config, history.stateRef]);

  const onView = useCallback((next: ViewState, transient: boolean, refresh = true) => history.set((c) => ({ ...c, view: next }), transient, refresh), [history.set]);
  const onSize = useCallback((w: number, h: number) => {
    sizeRef.current = { w, h };
  }, []);

  const zoomBy = useCallback((f: number) => history.set((c) => ({ ...c, view: zoomViewAt(c.view, sizeRef.current.w, sizeRef.current.h, f) })), [history.set]);
  const rotateBy = useCallback((d: number) => history.set((c) => ({ ...c, view: rotateViewTo(c.view, sizeRef.current.w, sizeRef.current.h, c.view.angle + d) })), [history.set]);
  const straighten = useCallback(() => history.set((c) => ({ ...c, view: clampView({ ...c.view, angle: 0 }) })), [history.set]);
  const resetView = useCallback(() => history.set((c) => ({ ...c, view: c.scenario ? { ...(c.atlasSheet?ATLAS_SHEETS[c.atlasSheet].view:SCENARIO_VIEW) } : { ...DEFAULT_VIEW, projection: c.view.projection } })), [history.set]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
        return;
      }
      if (meta && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        history.redo();
        return;
      }
      const { w, h } = sizeRef.current;
      const step = e.shiftKey ? 120 : 40;
      const pan = (dx: number, dy: number) => history.set((c) => ({ ...c, view: panView(c.view, w, h, dx, dy) }));
      switch (e.key) {
        case 'ArrowLeft':
          pan(step, 0);
          break;
        case 'ArrowRight':
          pan(-step, 0);
          break;
        case 'ArrowUp':
          pan(0, step);
          break;
        case 'ArrowDown':
          pan(0, -step);
          break;
        case '+':
        case '=':
          zoomBy(1.25);
          break;
        case '-':
        case '_':
          zoomBy(1 / 1.25);
          break;
        case 'q':
        case 'Q':
          rotateBy(e.shiftKey ? -45 : -5);
          break;
        case 'e':
        case 'E':
          rotateBy(e.shiftKey ? 45 : 5);
          break;
        case '0':
          straighten();
          break;
        case 'r':
        case 'R':
          resetView();
          break;
        case 'v':
        case 'V':
          setMode('pan');
          break;
        case 'c':
        case 'C':
          setMode('rotate');
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history, zoomBy, rotateBy, straighten, resetView]);

  const share = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(config));
      setToast('Style JSON copied to clipboard');
    } catch {
      setToast('Clipboard unavailable');
    }
    setTimeout(() => setToast(null), 2200);
  };

  // The layer controls depend on artwork settings and loaded data, not the live camera.
  const layerControls = useMemo(() => (
    <>
      <ScenarioPanel config={config} update={update} replace={replace} data={data} commit={commit} />
      <LayersPanel config={config} update={update} commit={commit} loading={loading} errors={errors} retry={retry} />
    </>
  ), [config.scenario, config.atlasSheet, config.atlasTheme, config.coastDetail, config.waterDetail,
    config.layers, config.territoryColors, config.labelEdits, data, loading, errors, retry, update, replace, commit]);

  const errorKeys = Object.keys(errors);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/5 bg-zinc-950 px-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-amber-300 to-orange-500 text-zinc-900 shadow-lg shadow-amber-500/20">
            <MapIcon className="h-4 w-4" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">Meridian</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Map art studio</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={history.undo} disabled={!history.canUndo} title="Undo (Ctrl+Z)" className="rounded-md p-1.5 text-zinc-300 hover:bg-white/10 disabled:opacity-30">
            <Undo2 className="h-4 w-4" />
          </button>
          <button onClick={history.redo} disabled={!history.canRedo} title="Redo (Ctrl+Shift+Z)" className="rounded-md p-1.5 text-zinc-300 hover:bg-white/10 disabled:opacity-30">
            <Redo2 className="h-4 w-4" />
          </button>
          <span className="mx-1 h-5 w-px bg-white/10" />
          <button onClick={share} title="Copy style JSON" className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-white/10">
            <Share2 className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Copy style</span>
          </button>
          <button onClick={() => setTab('export')} className="inline-flex items-center gap-1.5 rounded-md bg-amber-400 px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-amber-300">
            <Download className="h-3.5 w-3.5" /> Export
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col-reverse md:flex-row">
        {/* Sidebar */}
        <aside className="flex h-[43%] w-full shrink-0 flex-col border-r border-white/5 bg-zinc-950 md:h-auto md:w-[340px]">
          <nav className="grid grid-cols-4 border-b border-white/5">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn('flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium uppercase tracking-wider transition-colors', tab === t.id ? 'border-b-2 border-amber-400 text-amber-300' : 'text-zinc-500 hover:text-zinc-200')}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'layers' && layerControls}
            {tab === 'style' && <StylePanel config={config} update={update} commit={commit} />}
            {tab === 'view' && <ViewPanel config={config} update={update} />}
            {tab === 'export' && <ExportPanel config={config} data={data} update={update} replace={replace} loadingCount={loading.length} />}
          </div>
        </aside>

        {/* Canvas area */}
        <main className="relative min-w-0 flex-1 bg-[radial-gradient(ellipse_at_center,#1c1c21_0%,#09090b_75%)]">
          <MapCanvas config={config} data={data} mode={mode} onView={onView} onCommit={commit} onSize={onSize} />

          {/* Status chips */}
          <div className="pointer-events-none absolute left-4 top-4 flex flex-col gap-1.5">
            {loading.map((k) => (
              <div key={k} className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-white/10 bg-zinc-950/80 px-3 py-1 text-[11px] text-zinc-200 backdrop-blur">
                <Loader2 className="h-3 w-3 animate-spin text-amber-300" /> Loading {describeKey(k)}…
              </div>
            ))}
            {errorKeys.map((k) => (
              <button key={k} onClick={() => retry(k)} className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-red-400/30 bg-red-950/70 px-3 py-1 text-[11px] text-red-200 backdrop-blur hover:bg-red-900/70">
                Failed to load {describeKey(k)} — retry
              </button>
            ))}
          </div>

          <div className="pointer-events-none absolute right-4 top-4 rounded-full border border-white/10 bg-zinc-950/70 px-3 py-1 text-[11px] tabular-nums text-zinc-400 backdrop-blur">
            {config.width} × {config.height} · {Math.abs(config.view.lat).toFixed(1)}°{config.view.lat >= 0 ? 'N' : 'S'} {Math.abs(config.view.lon).toFixed(1)}°{config.view.lon >= 0 ? 'E' : 'W'}
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
            <Toolbar view={config.view} mode={mode} onMode={setMode} onZoom={zoomBy} onRotate={rotateBy} onStraighten={straighten} onReset={resetView} />
          </div>

          {toast && <div className="absolute bottom-20 left-1/2 -translate-x-1/2 rounded-full bg-zinc-100 px-4 py-1.5 text-xs font-medium text-zinc-900 shadow-xl">{toast}</div>}
        </main>
      </div>
    </div>
  );
}
