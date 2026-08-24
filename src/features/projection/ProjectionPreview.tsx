import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import type { MapDocument } from '../../core/model/map-document';
import { drawRenderPlan } from '../../core/render/canvas-renderer';
import type { RenderPlan, RenderWarning } from '../../core/render/render-plan';
import type { LoadedSourceMap } from '../../types/source-map';

const DEFAULT_DEBOUNCE_MS = 100;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 16;
const CHECKER_SIZE = 12;
const DEFAULT_BACKDROP: ProjectionPreviewBackdrop = 'dark';
const WORKER_UNAVAILABLE_MESSAGE = '当前环境无法启动投影工作线程。';

export interface ProjectionWorkerRequest {
  protocolVersion: 1;
  type: 'build';
  requestId: number;
  revision: number;
  document: MapDocument;
  source: LoadedSourceMap;
  precision: 'preview';
}

export interface ProjectionWorkerCancelRequest {
  protocolVersion: 1;
  type: 'cancel';
  requestId: number;
}

export type ProjectionWorkerMessage = ProjectionWorkerRequest | ProjectionWorkerCancelRequest;

export type ProjectionWorkerResponse =
  | {
      type: 'result';
      requestId: number;
      revision: number;
      plan: RenderPlan;
    }
  | {
      type: 'error';
      requestId: number;
      revision: number;
      message: string;
    };

export interface ProjectionRenderInput {
  document: MapDocument;
  source: LoadedSourceMap;
  requestId: number;
  revision: number;
  signal: AbortSignal;
}

export type ProjectionRenderCallback = (
  input: ProjectionRenderInput,
) => RenderPlan | Promise<RenderPlan>;

export type ProjectionPreviewBackdrop = 'checker' | 'dark';

export interface ProjectionPreviewProps extends Omit<
  HTMLAttributes<HTMLElement>,
  'children' | 'onError'
> {
  document: MapDocument;
  source: LoadedSourceMap | null;
  /** Monotonically increasing document revision used for stale-result rejection. */
  revision: number;
  /** Used if Worker is unavailable or fails to start. */
  renderFallback?: ProjectionRenderCallback;
  onLatestPlanChange?: (plan: RenderPlan | null) => void;
  onPendingChange?: (pending: boolean) => void;
  onError?: (error: Error | null) => void;
  createWorker?: () => Worker;
  debounceMs?: number;
  initialBackdrop?: ProjectionPreviewBackdrop;
  className?: string;
}

interface ViewportSize {
  width: number;
  height: number;
}

interface ViewTransform {
  zoom: number;
  /** Pan offset from the fitted center, in viewport CSS pixels. */
  x: number;
  y: number;
}

interface PendingRequest {
  id: number;
  revision: number;
  mode: 'worker' | 'fallback';
}

interface DragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
}

interface RenderBuffer {
  plan: RenderPlan;
  canvas: HTMLCanvasElement;
}

const styles = {
  root: {
    position: 'relative',
    display: 'grid',
    gridTemplateRows: 'auto minmax(0, 1fr) auto',
    minWidth: 0,
    minHeight: 0,
    height: '100%',
    overflow: 'hidden',
    color: '#f4f4f5',
    background: '#18181b',
    fontFamily: 'inherit',
  },
  toolbar: {
    zIndex: 2,
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    minHeight: 40,
    padding: '6px 10px',
    borderBottom: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(24,24,27,0.96)',
  },
  button: {
    minWidth: 32,
    minHeight: 30,
    padding: '4px 9px',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: 4,
    color: 'inherit',
    background: '#27272a',
    font: 'inherit',
    cursor: 'pointer',
  },
  activeButton: {
    borderColor: '#a1a1aa',
    background: '#52525b',
  },
  zoomValue: {
    minWidth: '5ch',
    color: '#d4d4d8',
    fontSize: 13,
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'center',
  },
  canvasViewport: {
    position: 'relative',
    minWidth: 0,
    minHeight: 120,
    overflow: 'hidden',
    outline: 'none',
    touchAction: 'none',
    userSelect: 'none',
  },
  canvas: {
    display: 'block',
    width: '100%',
    height: '100%',
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    padding: 24,
    color: '#e4e4e7',
    background: 'rgba(9,9,11,0.58)',
    textAlign: 'center',
    pointerEvents: 'none',
  },
  footer: {
    zIndex: 2,
    minHeight: 28,
    padding: '5px 10px',
    borderTop: '1px solid rgba(255,255,255,0.12)',
    color: '#d4d4d8',
    background: 'rgba(24,24,27,0.96)',
    fontSize: 12,
  },
  warningList: {
    display: 'grid',
    gap: 3,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  warningError: { color: '#fca5a5' },
  warningWarning: { color: '#fde68a' },
  warningInfo: { color: '#bfdbfe' },
} satisfies Record<string, CSSProperties>;

function defaultCreateWorker(): Worker {
  return new Worker(new URL('../../workers/projection.worker.ts', import.meta.url), {
    type: 'module',
    name: 'maptool-projection',
  });
}

function toError(value: unknown, fallbackMessage = '生成投影预览失败。'): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string' && value.trim()) return new Error(value);
  if (typeof value === 'object' && value !== null && 'message' in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return new Error(message);
  }
  return new Error(fallbackMessage);
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function isWorkerResponse(value: unknown): value is ProjectionWorkerResponse {
  if (typeof value !== 'object' || value === null) return false;
  const response = value as Partial<ProjectionWorkerResponse>;
  return (
    (response.type === 'result' || response.type === 'error') &&
    typeof response.requestId === 'number' &&
    typeof response.revision === 'number'
  );
}

function warningStyle(warning: RenderWarning): CSSProperties {
  if (warning.severity === 'error') return styles.warningError;
  if (warning.severity === 'warning') return styles.warningWarning;
  return styles.warningInfo;
}

function drawBackdrop(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  backdrop: ProjectionPreviewBackdrop,
): void {
  context.save();
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (backdrop === 'dark') {
    context.fillStyle = '#000000';
    context.fillRect(0, 0, width, height);
  } else {
    context.fillStyle = '#d4d4d8';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#a1a1aa';
    for (let y = 0; y < height; y += CHECKER_SIZE) {
      for (let x = 0; x < width; x += CHECKER_SIZE) {
        if ((x / CHECKER_SIZE + y / CHECKER_SIZE) % 2 === 0) {
          context.fillRect(x, y, CHECKER_SIZE, CHECKER_SIZE);
        }
      }
    }
  }
  context.restore();
}

function resetViewTransform(): ViewTransform {
  return { zoom: 1, x: 0, y: 0 };
}

function fittedPlanOrigin(
  plan: RenderPlan,
  viewport: ViewportSize,
  zoom: number,
): { x: number; y: number; scale: number } {
  const fitScale = Math.min(viewport.width / plan.width, viewport.height / plan.height);
  const scale = fitScale * zoom;
  return {
    scale,
    x: (viewport.width - plan.width * scale) / 2,
    y: (viewport.height - plan.height * scale) / 2,
  };
}

/**
 * Interactive, renderer-neutral projection preview. Requests are debounced and
 * revision/request IDs ensure late Worker or fallback results are ignored.
 */
export function ProjectionPreview({
  document,
  source,
  revision,
  renderFallback,
  onLatestPlanChange,
  onPendingChange,
  onError,
  createWorker = defaultCreateWorker,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  initialBackdrop = DEFAULT_BACKDROP,
  className,
  style,
  ...props
}: ProjectionPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const workerUnavailableRef = useRef(false);
  const fallbackAbortRef = useRef<AbortController | null>(null);
  const pendingRequestRef = useRef<PendingRequest | null>(null);
  const requestSequenceRef = useRef(0);
  const lastRequestAtRef = useRef(0);
  const latestInputsRef = useRef({ document, source, revision, renderFallback });
  const dragRef = useRef<DragState | null>(null);
  const renderBufferRef = useRef<RenderBuffer | null>(null);

  const [plan, setPlan] = useState<RenderPlan | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [backdrop, setBackdrop] = useState<ProjectionPreviewBackdrop>(initialBackdrop);
  const [viewport, setViewport] = useState<ViewportSize>({ width: 0, height: 0 });
  const [view, setView] = useState<ViewTransform>({ zoom: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const statusId = useId();

  useLayoutEffect(() => {
    latestInputsRef.current = { document, source, revision, renderFallback };
  }, [document, renderFallback, revision, source]);

  const updatePending = useCallback(
    (value: boolean) => {
      setPending(value);
      onPendingChange?.(value);
    },
    [onPendingChange],
  );

  const updateError = useCallback(
    (value: Error | null) => {
      setError(value);
      onError?.(value);
    },
    [onError],
  );

  const acceptPlan = useCallback(
    (nextPlan: RenderPlan, request: PendingRequest) => {
      const current = pendingRequestRef.current;
      const latest = latestInputsRef.current;
      if (
        !current ||
        current.id !== request.id ||
        current.revision !== request.revision ||
        latest.revision !== request.revision ||
        nextPlan.revision !== request.revision
      ) {
        return;
      }

      pendingRequestRef.current = null;
      setPlan(nextPlan);
      updateError(null);
      updatePending(false);
      onLatestPlanChange?.(nextPlan);
    },
    [onLatestPlanChange, updateError, updatePending],
  );

  const failRequest = useCallback(
    (reason: unknown, request: PendingRequest) => {
      const current = pendingRequestRef.current;
      if (
        !current ||
        current.id !== request.id ||
        current.revision !== request.revision ||
        latestInputsRef.current.revision !== request.revision
      ) {
        return;
      }
      pendingRequestRef.current = null;
      updatePending(false);
      updateError(toError(reason));
    },
    [updateError, updatePending],
  );

  const renderWithFallback = useCallback(
    (request: PendingRequest, cause?: unknown) => {
      const currentInputs = latestInputsRef.current;
      if (!currentInputs.source || !currentInputs.renderFallback) {
        failRequest(cause ?? new Error(WORKER_UNAVAILABLE_MESSAGE), request);
        return;
      }

      const controller = new AbortController();
      fallbackAbortRef.current?.abort();
      fallbackAbortRef.current = controller;
      const fallbackRequest: PendingRequest = { ...request, mode: 'fallback' };
      pendingRequestRef.current = fallbackRequest;

      Promise.resolve()
        .then(() =>
          currentInputs.renderFallback!({
            document: currentInputs.document,
            source: currentInputs.source!,
            requestId: fallbackRequest.id,
            revision: fallbackRequest.revision,
            signal: controller.signal,
          }),
        )
        .then((nextPlan) => {
          if (!controller.signal.aborted) acceptPlan(nextPlan, fallbackRequest);
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) failRequest(reason, fallbackRequest);
        });
    },
    [acceptPlan, failRequest],
  );

  const ensureWorker = useCallback((): Worker | null => {
    if (workerRef.current) return workerRef.current;
    if (workerUnavailableRef.current || typeof Worker === 'undefined') return null;

    try {
      const worker = createWorker();
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (!isWorkerResponse(event.data)) return;
        const current = pendingRequestRef.current;
        if (
          !current ||
          current.mode !== 'worker' ||
          current.id !== event.data.requestId ||
          current.revision !== event.data.revision
        ) {
          return;
        }
        if (event.data.type === 'result') acceptPlan(event.data.plan, current);
        else failRequest(event.data.message, current);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        const current = pendingRequestRef.current;
        worker.terminate();
        workerRef.current = null;
        workerUnavailableRef.current = true;
        if (!current || current.mode !== 'worker') return;
        renderWithFallback(current, new Error(event.message || '投影工作线程发生错误。'));
      };
      worker.onmessageerror = () => {
        const current = pendingRequestRef.current;
        worker.terminate();
        workerRef.current = null;
        workerUnavailableRef.current = true;
        if (!current || current.mode !== 'worker') return;
        renderWithFallback(current, new Error('无法读取投影工作线程的结果。'));
      };
      workerRef.current = worker;
      return worker;
    } catch {
      workerUnavailableRef.current = true;
      return null;
    }
  }, [acceptPlan, createWorker, failRequest, renderWithFallback]);

  useEffect(() => {
    const previous = pendingRequestRef.current;
    if (previous?.mode === 'worker') {
      workerRef.current?.postMessage({
        protocolVersion: 1,
        type: 'cancel',
        requestId: previous.id,
      } satisfies ProjectionWorkerCancelRequest);
    }
    fallbackAbortRef.current?.abort();
    pendingRequestRef.current = null;

    const elapsedSinceLastRequest = performance.now() - lastRequestAtRef.current;
    const requestedDelay = source ? Math.max(0, debounceMs) : 0;
    const coalescedDelay = Math.max(0, requestedDelay - elapsedSinceLastRequest);
    const timeout = window.setTimeout(
      () => {
        if (!source) {
          updatePending(false);
          updateError(null);
          setPlan(null);
          onLatestPlanChange?.(null);
          return;
        }

        lastRequestAtRef.current = performance.now();
        updatePending(true);
        updateError(null);
        const request: PendingRequest = {
          id: ++requestSequenceRef.current,
          revision,
          mode: 'worker',
        };
        pendingRequestRef.current = request;
        const worker = ensureWorker();
        if (worker) {
          worker.postMessage({
            protocolVersion: 1,
            type: 'build',
            requestId: request.id,
            revision,
            document,
            source,
            precision: 'preview',
          } satisfies ProjectionWorkerRequest);
        } else {
          renderWithFallback(request, new Error(WORKER_UNAVAILABLE_MESSAGE));
        }
      },
      coalescedDelay,
    );

    return () => window.clearTimeout(timeout);
  }, [
    debounceMs,
    document,
    ensureWorker,
    onLatestPlanChange,
    renderWithFallback,
    revision,
    source,
    updateError,
    updatePending,
  ]);

  useEffect(
    () => () => {
      fallbackAbortRef.current?.abort();
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setViewport({
        width: Math.max(0, rect.width),
        height: Math.max(0, rect.height),
      });
    };
    updateSize();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || viewport.width <= 0 || viewport.height <= 0) return;
    const context = canvas.getContext('2d');
    if (!context) {
      updateError(new Error('当前浏览器不支持 Canvas 2D 预览。'));
      return;
    }

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(viewport.width * dpr));
    const pixelHeight = Math.max(1, Math.round(viewport.height * dpr));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, pixelWidth, pixelHeight);
    drawBackdrop(context, viewport.width, viewport.height, dpr, backdrop);
    if (!plan || plan.width <= 0 || plan.height <= 0) return;

    const fitted = fittedPlanOrigin(plan, viewport, view.zoom);
    const scale = dpr * fitted.scale;
    context.save();
    context.setTransform(scale, 0, 0, scale, dpr * (fitted.x + view.x), dpr * (fitted.y + view.y));
    context.beginPath();
    context.rect(0, 0, plan.width, plan.height);
    context.clip();

    // drawRenderPlan resets its own transform; cache a plan-sized buffer so the
    // shared renderer stays unchanged and pan/zoom only re-composites the result.
    let buffer = renderBufferRef.current;
    if (buffer?.plan !== plan) {
      const canvasBuffer = documentCanvas(plan.width, plan.height);
      const bufferContext = canvasBuffer?.getContext('2d');
      if (canvasBuffer && bufferContext) {
        drawRenderPlan(bufferContext, plan);
        buffer = { plan, canvas: canvasBuffer };
        renderBufferRef.current = buffer;
      }
    }
    if (buffer?.plan === plan) context.drawImage(buffer.canvas, 0, 0);
    context.restore();
  }, [backdrop, plan, updateError, view, viewport]);

  const resetView = useCallback(() => {
    setView(resetViewTransform());
  }, []);

  const zoomAt = useCallback(
    (nextZoom: number, anchorX = viewport.width / 2, anchorY = viewport.height / 2) => {
      if (!plan) return;
      setView((current) => {
        const zoom = clampZoom(nextZoom);
        const ratio = zoom / current.zoom;
        const currentOrigin = fittedPlanOrigin(plan, viewport, current.zoom);
        const nextOrigin = fittedPlanOrigin(plan, viewport, zoom);
        return {
          zoom,
          x: anchorX - nextOrigin.x - (anchorX - currentOrigin.x - current.x) * ratio,
          y: anchorY - nextOrigin.y - (anchorY - currentOrigin.y - current.y) * ratio,
        };
      });
    },
    [plan, viewport],
  );

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (!plan) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const multiplier = Math.exp(-event.deltaY * 0.0015);
      zoomAt(view.zoom * multiplier, event.clientX - rect.left, event.clientY - rect.top);
    },
    [plan, view.zoom, zoomAt],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!plan) return;
      const panStep = event.shiftKey ? 80 : 24;
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomAt(view.zoom * 1.25);
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        zoomAt(view.zoom / 1.25);
      } else if (event.key === '0' || event.key === 'Home') {
        event.preventDefault();
        resetView();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setView((current) => ({ ...current, x: current.x + panStep }));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setView((current) => ({ ...current, x: current.x - panStep }));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setView((current) => ({ ...current, y: current.y + panStep }));
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setView((current) => ({ ...current, y: current.y - panStep }));
      }
    },
    [plan, resetView, view.zoom, zoomAt],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!plan || event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: view.x,
        startY: view.y,
      };
      setDragging(true);
    },
    [plan, view.x, view.y],
  );

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setView((current) => ({
      ...current,
      x: drag.startX + event.clientX - drag.startClientX,
      y: drag.startY + event.clientY - drag.startClientY,
    }));
  }, []);

  const finishDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const rootClassName = ['projection-preview', className].filter(Boolean).join(' ');
  const warnings = plan?.warnings ?? [];
  const overlayMessage = error && !plan
    ? error.message
    : pending && !plan
      ? '正在生成投影预览…'
      : !source
        ? '等待源图数据…'
        : !plan
          ? '暂无投影预览。'
          : null;

  return (
    <section
      aria-label="投影预览"
      aria-busy={pending}
      className={rootClassName}
      style={{ ...styles.root, ...style }}
      {...props}
    >
      <div style={styles.toolbar} role="toolbar" aria-label="预览视图控制">
        <button
          type="button"
          style={styles.button}
          onClick={() => zoomAt(view.zoom / 1.25)}
          disabled={!plan}
          aria-label="缩小预览"
          title="缩小"
        >
          −
        </button>
        <output style={styles.zoomValue} aria-label="当前缩放比例">
          {Math.round(view.zoom * 100)}%
        </output>
        <button
          type="button"
          style={styles.button}
          onClick={() => zoomAt(view.zoom * 1.25)}
          disabled={!plan}
          aria-label="放大预览"
          title="放大"
        >
          +
        </button>
        <button
          type="button"
          style={styles.button}
          onClick={resetView}
          disabled={!plan}
          aria-label="重置缩放和平移"
        >
          适合窗口
        </button>
        <button
          type="button"
          style={{ ...styles.button, ...(backdrop === 'checker' ? styles.activeButton : null) }}
          onClick={() => setBackdrop('checker')}
          aria-pressed={backdrop === 'checker'}
          aria-label="使用棋盘预览衬底"
        >
          棋盘衬底
        </button>
        <button
          type="button"
          style={{ ...styles.button, ...(backdrop === 'dark' ? styles.activeButton : null) }}
          onClick={() => setBackdrop('dark')}
          aria-pressed={backdrop === 'dark'}
          aria-label="使用深色预览衬底"
        >
          深色衬底
        </button>
      </div>

      <div
        ref={viewportRef}
        style={{ ...styles.canvasViewport, cursor: dragging ? 'grabbing' : 'grab' }}
        tabIndex={0}
        role="img"
        aria-label="二维投影画布；可拖动或使用方向键平移，滚轮或加减键缩放，零键重置"
        aria-describedby={statusId}
        onKeyDown={handleKeyDown}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <canvas ref={canvasRef} style={styles.canvas} aria-hidden="true" />
        {overlayMessage ? (
          <div
            style={{ ...styles.overlay, ...(error ? styles.warningError : null) }}
            role={error ? 'alert' : 'status'}
            aria-live="polite"
          >
            {overlayMessage}
          </div>
        ) : null}
      </div>

      <footer id={statusId} style={styles.footer} aria-live="polite" aria-atomic="true">
        {warnings.length > 0 ? (
          <ul style={styles.warningList} aria-label={`渲染提示，共 ${warnings.length} 条`}>
            {warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`} style={warningStyle(warning)}>
                {warning.severity === 'error'
                  ? '错误'
                  : warning.severity === 'warning'
                    ? '警告'
                    : '提示'}
                ：{warning.message}
              </li>
            ))}
          </ul>
        ) : error ? (
          <span style={styles.warningError}>预览失败：{error.message}</span>
        ) : pending ? (
          <span>实时预览更新中…</span>
        ) : plan ? (
          <span>
            {plan.width} × {plan.height} · {plan.stats.outputPoints.toLocaleString()} 点 ·{' '}
            {plan.stats.elapsedMs.toFixed(1)} 毫秒
          </span>
        ) : (
          <span>尚无可显示的渲染结果。</span>
        )}
      </footer>
    </section>
  );
}

function documentCanvas(width: number, height: number): HTMLCanvasElement | null {
  if (typeof window === 'undefined') return null;
  const canvas = window.document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return canvas;
}
