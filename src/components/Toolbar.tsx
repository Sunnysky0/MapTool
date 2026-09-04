import { Hand, Maximize2, Minus, Plus, RotateCcw, RotateCw, Compass, Crosshair } from 'lucide-react';
import type { ViewState } from '../types';
import type { InteractionMode } from './MapCanvas';
import { cn } from '../utils/cn';

interface Props {
  view: ViewState;
  mode: InteractionMode;
  onMode: (m: InteractionMode) => void;
  onZoom: (factor: number) => void;
  onRotate: (delta: number) => void;
  onStraighten: () => void;
  onReset: () => void;
}

function IconBtn({ children, onClick, title, active }: { children: React.ReactNode; onClick: () => void; title: string; active?: boolean }) {
  return (
    <button onClick={onClick} title={title} className={cn('flex h-8 w-8 items-center justify-center rounded-md transition-colors', active ? 'bg-amber-400 text-zinc-900' : 'text-zinc-300 hover:bg-white/10 hover:text-white')}>
      {children}
    </button>
  );
}

export default function Toolbar({ view, mode, onMode, onZoom, onRotate, onStraighten, onReset }: Props) {
  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-white/10 bg-zinc-950/85 p-1 shadow-2xl backdrop-blur">
      <IconBtn title="Pan mode (drag to move)" onClick={() => onMode('pan')} active={mode === 'pan'}>
        <Hand className="h-4 w-4" />
      </IconBtn>
      <IconBtn title="Rotate mode (drag to rotate)" onClick={() => onMode('rotate')} active={mode === 'rotate'}>
        <Compass className="h-4 w-4" />
      </IconBtn>
      <span className="mx-1 h-5 w-px bg-white/10" />
      <IconBtn title="Zoom out (−)" onClick={() => onZoom(1 / 1.4)}>
        <Minus className="h-4 w-4" />
      </IconBtn>
      <span className="w-14 text-center text-[11px] tabular-nums text-zinc-300">{view.zoom < 10 ? view.zoom.toFixed(1) : Math.round(view.zoom)}×</span>
      <IconBtn title="Zoom in (+)" onClick={() => onZoom(1.4)}>
        <Plus className="h-4 w-4" />
      </IconBtn>
      <span className="mx-1 h-5 w-px bg-white/10" />
      <IconBtn title="Rotate left 15° (Q)" onClick={() => onRotate(-15)}>
        <RotateCcw className="h-4 w-4" />
      </IconBtn>
      <button onClick={onStraighten} title="Straighten (0)" className="w-12 text-center text-[11px] tabular-nums text-zinc-300 hover:text-white">
        {Math.round(view.angle)}°
      </button>
      <IconBtn title="Rotate right 15° (E)" onClick={() => onRotate(15)}>
        <RotateCw className="h-4 w-4" />
      </IconBtn>
      <span className="mx-1 h-5 w-px bg-white/10" />
      <IconBtn title="Straighten" onClick={onStraighten}>
        <Crosshair className="h-4 w-4" />
      </IconBtn>
      <IconBtn title="Reset view (R)" onClick={onReset}>
        <Maximize2 className="h-4 w-4" />
      </IconBtn>
    </div>
  );
}
