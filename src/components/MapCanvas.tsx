import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LayerData, MapConfig, ViewState } from '../types';
import { mapPainter } from '../lib/mapPainter';
import { panView, rotateViewTo, zoomViewAt, keepPointUnderCursor, clampView } from '../lib/view';

export type InteractionMode = 'pan' | 'rotate';

interface Props {
  config: MapConfig;
  data: Record<string, LayerData | undefined>;
  mode: InteractionMode;
  onView: (next: ViewState, transient: boolean, refreshControls?: boolean) => void;
  onCommit: () => void;
  onSize?: (w: number, h: number) => void;
}

interface Ptr {
  x: number;
  y: number;
}

export default function MapCanvas({ config, data, mode, onView, onCommit, onSize }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const viewRef = useRef(config.view);
  const published = useRef(config.view);
  const notified = useRef(config.view);
  const nextControlsUpdate = useRef(0);
  const frame = useRef(0);
  const wheelTimer = useRef(0);
  const active = useRef(false);
  const [interacting, setInteracting] = useState(false);
  const painter = useRef<ReturnType<typeof mapPainter> | null>(null);
  const pointers = useRef(new Map<number, Ptr>());
  const gesture = useRef<{ dist: number; angle: number; mid: Ptr } | null>(null);
  const dragging = useRef(false);
  const [cursor, setCursor] = useState('grab');

  // Artboard size that fits the wrapper while keeping the export aspect ratio
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const pad = r.width < 520 ? 12 : 40;
      const aw = Math.max(50, r.width - pad * 2);
      const ah = Math.max(50, r.height - pad * 2);
      const ratio = config.width / config.height;
      let w = aw;
      let h = w / ratio;
      if (h > ah) {
        h = ah;
        w = h * ratio;
      }
      setBox({ w: Math.floor(w), h: Math.floor(h) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [config.width, config.height]);

  useEffect(() => {
    if (box.w && box.h) onSize?.(box.w, box.h);
  }, [box, onSize]);

  const renderInput = useMemo(() => ({config, data, width: box.w, height: box.h}), [config, data, box]);
  const inputRef = useRef(renderInput);

  useLayoutEffect(() => {
    painter.current = mapPainter(canvasRef.current!);
    return () => {
      painter.current?.dispose();
      painter.current = null;
      cancelAnimationFrame(frame.current);
      window.clearTimeout(wheelTimer.current);
    };
  }, []);

  const publish = useCallback((renderControls: boolean) => {
    if (viewRef.current !== published.current) {
      published.current = viewRef.current;
      if (renderControls) notified.current = viewRef.current;
      onView(viewRef.current, true, renderControls);
    }
  }, [onView]);

  const schedule = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const input = inputRef.current;
      if (!input.width || !input.height) return;
      painter.current?.preview({...input, config: {...input.config, view: viewRef.current}});
      // Keep history current each frame; the coordinate readout and controls
      // can repaint less frequently than the map.
      const now = performance.now();
      const refresh = now >= nextControlsUpdate.current;
      if (refresh) nextControlsUpdate.current = now + 100;
      publish(refresh);
    });
  }, [publish]);

  const move = useCallback((next: ViewState) => {
    if (!active.current) {
      painter.current?.invalidate();
      active.current = true;
      nextControlsUpdate.current = 0;
      setInteracting(true);
    }
    viewRef.current = next;
    schedule();
  }, [schedule]);

  const finish = useCallback(() => {
    if (!active.current) return;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    publish(true);
    notified.current = viewRef.current;
    onCommit();
    active.current = false;
    setInteracting(false);
  }, [publish, onCommit]);

  useLayoutEffect(() => {
    const previous = inputRef.current;
    inputRef.current = renderInput;
    if (config.view !== previous.config.view && config.view !== notified.current) {
      // An undo, import or external view control supersedes an in-flight gesture.
      viewRef.current = published.current = notified.current = config.view;
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      window.clearTimeout(wheelTimer.current);
      pointers.current.clear();
      gesture.current = null;
      dragging.current = active.current = false;
      setCursor('grab');
      setInteracting(false);
    }
    if (!box.w || !box.h) return;
    if (!active.current) painter.current?.full(renderInput);
    else if (previous.data !== data || previous.width !== box.w || previous.height !== box.h ||
      (previous.config !== config && previous.config.view === config.view)) schedule();
  }, [renderInput, interacting, box, data, config, schedule]);

  const local = (e: { clientX: number; clientY: number }): Ptr => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1) return;
    window.clearTimeout(wheelTimer.current);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    dragging.current = true;
    setCursor('grabbing');
    if (pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values());
      gesture.current = { dist: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const prev = pointers.current.get(e.pointerId)!;
    const cur = local(e);
    if (prev.x === cur.x && prev.y === cur.y) return;
    pointers.current.set(e.pointerId, cur);
    const { w, h } = box;
    let v = viewRef.current;

    if (pointers.current.size >= 2 && gesture.current) {
      const [a, b] = Array.from(pointers.current.values());
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const g = gesture.current;
      const factor = dist / Math.max(1, g.dist);
      const dAng = ((ang - g.angle) * 180) / Math.PI;
      const next = clampView({ ...v, zoom: v.zoom * factor, angle: v.angle + dAng });
      v = keepPointUnderCursor(v, next, w, h, g.mid.x, g.mid.y);
      v = panView(v, w, h, mid.x - g.mid.x, mid.y - g.mid.y);
      gesture.current = { dist, angle: ang, mid };
      move(v);
      return;
    }

    const rotating = mode === 'rotate' || e.shiftKey || e.buttons === 2 || (e.type === 'pointerup' && e.button === 2);
    if (rotating) {
      const cx = w / 2;
      const cy = h / 2;
      const a1 = Math.atan2(prev.y - cy, prev.x - cx);
      const a2 = Math.atan2(cur.y - cy, cur.x - cx);
      const d = ((a2 - a1) * 180) / Math.PI;
      move(rotateViewTo(v, w, h, v.angle + d));
    } else {
      move(panView(v, w, h, cur.x - prev.x, cur.y - prev.y));
    }
  };

  const endPointer = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    if (e.type === 'pointerup') onPointerMove(e);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
    if (pointers.current.size === 0 && dragging.current) {
      dragging.current = false;
      setCursor('grab');
      finish();
    }
  };

  // Wheel: zoom at cursor (Alt/Ctrl + wheel rotates)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const v = viewRef.current;
      const {width: w, height: h} = inputRef.current;
      const delta = e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY;
      if (e.altKey || e.ctrlKey) {
        move(rotateViewTo(v, w, h, v.angle + delta * 0.1, px, py));
      } else {
        const factor = Math.exp(-delta * 0.0018);
        move(zoomViewAt(v, w, h, factor, px, py));
      }
      window.clearTimeout(wheelTimer.current);
      wheelTimer.current = window.setTimeout(() => { if (!pointers.current.size) finish(); }, 350);
    };
    canvas.addEventListener('wheel', handler, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', handler);
      window.clearTimeout(wheelTimer.current);
    };
  }, [move, finish]);

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const p = local(e);
      const v = viewRef.current;
      onView(zoomViewAt(v, box.w, box.h, e.shiftKey ? 0.5 : 2, p.x, p.y), false);
    },
    [box, onView],
  );

  return (
    <div ref={wrapRef} data-map-interacting={interacting || undefined} className="relative flex h-full w-full items-center justify-center overflow-hidden">
      <div className="relative bg-[conic-gradient(#d4d4d8_25%,#fafafa_0_50%,#d4d4d8_0_75%,#fafafa_0)] bg-[length:16px_16px] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] ring-1 ring-white/10" style={{ width: box.w, height: box.h }}>
        <canvas
          ref={canvasRef}
          style={{ width: box.w, height: box.h, cursor: mode === 'rotate' ? 'alias' : cursor, touchAction: 'none' }}
          className="block select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onLostPointerCapture={endPointer}
          onDoubleClick={onDoubleClick}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
    </div>
  );
}
