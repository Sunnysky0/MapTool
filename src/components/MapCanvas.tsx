import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LayerData, MapConfig, ViewState } from '../types';
import { drawMap } from '../lib/render';
import { panView, rotateViewTo, zoomViewAt, keepPointUnderCursor, clampView } from '../lib/view';

export type InteractionMode = 'pan' | 'rotate';

interface Props {
  config: MapConfig;
  data: Record<string, LayerData | undefined>;
  mode: InteractionMode;
  onView: (next: ViewState, transient: boolean) => void;
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
  viewRef.current = config.view;
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
      const pad = 40;
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

  // Render
  const renderInput = useMemo(() => ({ config, data, width: box.w, height: box.h }), [config, data, box]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !box.w || !box.h) return;
    let raf = 0;
    raf = requestAnimationFrame(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      if (canvas.width !== Math.round(box.w * dpr) || canvas.height !== Math.round(box.h * dpr)) {
        canvas.width = Math.round(box.w * dpr);
        canvas.height = Math.round(box.h * dpr);
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawMap(ctx, renderInput);
    });
    return () => cancelAnimationFrame(raf);
  }, [renderInput, box]);

  const local = (e: { clientX: number; clientY: number }): Ptr => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1) return;
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
      onView(v, true);
      return;
    }

    const rotating = mode === 'rotate' || e.shiftKey || e.buttons === 2;
    if (rotating) {
      const cx = w / 2;
      const cy = h / 2;
      const a1 = Math.atan2(prev.y - cy, prev.x - cx);
      const a2 = Math.atan2(cur.y - cy, cur.x - cx);
      const d = ((a2 - a1) * 180) / Math.PI;
      onView(rotateViewTo(v, w, h, v.angle + d), true);
    } else {
      onView(panView(v, w, h, cur.x - prev.x, cur.y - prev.y), true);
    }
  };

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
    if (pointers.current.size === 0 && dragging.current) {
      dragging.current = false;
      setCursor('grab');
      onCommit();
    }
  };

  // Wheel: zoom at cursor (Alt/Ctrl + wheel rotates)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let commitTimer: number | undefined;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const v = viewRef.current;
      const { w, h } = box;
      const delta = e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY;
      if (e.altKey || e.ctrlKey) {
        onView(rotateViewTo(v, w, h, v.angle + delta * 0.1, px, py), true);
      } else {
        const factor = Math.exp(-delta * 0.0018);
        onView(zoomViewAt(v, w, h, factor, px, py), true);
      }
      window.clearTimeout(commitTimer);
      commitTimer = window.setTimeout(() => onCommit(), 350);
    };
    canvas.addEventListener('wheel', handler, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', handler);
      window.clearTimeout(commitTimer);
    };
  }, [box, onView, onCommit]);

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const p = local(e);
      const v = viewRef.current;
      onView(zoomViewAt(v, box.w, box.h, e.shiftKey ? 0.5 : 2, p.x, p.y), false);
    },
    [box, onView],
  );

  return (
    <div ref={wrapRef} className="relative flex h-full w-full items-center justify-center overflow-hidden">
      <div className="relative shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] ring-1 ring-white/10" style={{ width: box.w, height: box.h }}>
        <canvas
          ref={canvasRef}
          style={{ width: box.w, height: box.h, cursor: mode === 'rotate' ? 'alias' : cursor, touchAction: 'none' }}
          className="block select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onDoubleClick={onDoubleClick}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
    </div>
  );
}
