import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell, Inspector, PreviewDrawer } from './components/layout';
import { loadSourceMap } from './core/assets/load-source-map';
import { downloadPng } from './core/export/exportPng';
import { downloadSvg } from './core/export/buildSvg';
import { createDefaultMapDocument, type MapDocument } from './core/model/map-document';
import { downloadProject } from './core/project/downloadProject';
import { loadProject } from './core/project/loadProject';
import { buildRenderPlan } from './core/render/build-render-plan';
import type { RenderPlan } from './core/render/render-plan';
import { autoProjectionCenter } from './core/projection';
import { validateProjection } from './core/projection/validation';
import { CalibrationHarness } from './dev/CalibrationHarness';
import { ExportPanel } from './features/export/ExportPanel';
import { ExtentControls } from './features/extent/ExtentControls';
import { GlobeViewport } from './features/globe';
import { ProjectionControls } from './features/projection/ProjectionControls';
import { ProjectionPreview } from './features/projection/ProjectionPreview';
import { StyleControls } from './features/style/StyleControls';
import { useProjectStore } from './store/project-store';
import { useUiStore } from './store/ui-store';
import type { LoadedSourceMap } from './types/source-map';

function basename(value: string): string {
  return value.trim().replace(/\.(svg|png|json)$/i, '') || 'maptool-map';
}

export default function App() {
  const calibrationMode = new URLSearchParams(window.location.search).has('calibration');
  const document = useProjectStore((state) => state.document);
  const setDocument = useProjectStore((state) => state.setDocument);
  const setExtent = useProjectStore((state) => state.setExtent);
  const inspectorOpen = useUiStore((state) => state.inspectorOpen);
  const previewOpen = useUiStore((state) => state.previewOpen);
  const setInspectorOpen = useUiStore((state) => state.setInspectorOpen);
  const setPreviewOpen = useUiStore((state) => state.setPreviewOpen);

  const [source, setSource] = useState<LoadedSourceMap | null>(null);
  const [revision, setRevision] = useState(1);
  const [latestPlan, setLatestPlan] = useState<RenderPlan | null>(null);
  const [filename, setFilename] = useState('world-linework');
  const [status, setStatus] = useState('正在载入规范线稿…');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewPending, setPreviewPending] = useState(false);
  const [draftExtent, setDraftExtent] = useState<MapDocument['extent'] | null>(null);

  useEffect(() => {
    if (calibrationMode) return;
    let active = true;
    void loadSourceMap('detail')
      .then((loaded) => {
        if (!active) return;
        setSource(loaded);
        const current = useProjectStore.getState().document;
        if (!current || current.source.sha256 !== loaded.manifest.source.sha256) {
          setDocument(
            createDefaultMapDocument({
              file: loaded.manifest.source.file,
              sha256: loaded.manifest.source.sha256,
              calibration: loaded.manifest.calibration,
            }),
          );
        }
        setStatus('源图已校验 · 可开始构图');
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setStatus('源图载入失败');
      });
    return () => {
      active = false;
    };
  }, [calibrationMode, setDocument]);

  const projectionValidation = useMemo(() => {
    if (!document) return { status: 'pending' as const, message: '等待项目文档。' };
    const id = document.projection.id as Parameters<typeof validateProjection>[0];
    const result = validateProjection(id, document.extent, autoProjectionCenter(document.extent));
    return result.valid
      ? { status: 'valid' as const, message: '当前投影与地理范围有效。' }
      : {
          status: 'error' as const,
          message: result.issues.map((issue) => issue.message).join(' '),
        };
  }, [document]);

  const previewDocument = useMemo(
    () => (document && draftExtent ? { ...document, extent: draftExtent } : document),
    [document, draftExtent],
  );

  const handlePreviewError = useCallback((reason: Error | null) => {
    setError(reason?.message ?? null);
  }, []);

  const renderFallback = useCallback(
    async ({
      document: snapshot,
      source: loaded,
      revision: requestRevision,
      signal,
    }: {
      document: MapDocument;
      source: LoadedSourceMap;
      revision: number;
      signal: AbortSignal;
    }) => {
      if (signal.aborted) throw new DOMException('已取消', 'AbortError');
      return buildRenderPlan(snapshot, loaded, {
        revision: requestRevision,
        precision: 'preview',
      });
    },
    [],
  );

  if (calibrationMode) return <CalibrationHarness />;
  if (!document || !previewDocument) {
    return (
      <div className="boot-state" role="status">
        {error ?? status}
      </div>
    );
  }

  const updateDocument = (next: MapDocument) => {
    setDocument(next);
    setRevision((value) => value + 1);
  };

  const ensureExportPlan = async () => {
    if (!source) throw new Error('源图数据尚未载入。');
    if (projectionValidation.status === 'error') throw new Error(projectionValidation.message);
    return buildRenderPlan(document, source, { revision, precision: 'export' });
  };

  const runExport = async (action: (plan: RenderPlan) => void | Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      const plan = await ensureExportPlan();
      await action(plan);
      setStatus('导出已完成');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const inspector = (
    <Inspector
      title="地图检查器"
      description="范围、投影与作品样式"
      open={inspectorOpen}
      onOpenChange={setInspectorOpen}
      openLabel="打开检查器"
      closeLabel="关闭检查器"
    >
      <ExtentControls
        value={document.extent}
        onChange={(extent) => updateDocument({ ...document, extent })}
        onReset={() => setExtent(createDefaultMapDocument(document.source).extent)}
      />
      <ProjectionControls
        value={document.projection}
        canvas={document.canvas}
        validation={projectionValidation}
        onChange={(projection) => updateDocument({ ...document, projection })}
        onCanvasChange={(canvas) => updateDocument({ ...document, canvas })}
        onAutoCenter={() => setRevision((value) => value + 1)}
        onReset={() => {
          const defaults = createDefaultMapDocument(document.source);
          updateDocument({ ...document, projection: defaults.projection, canvas: defaults.canvas });
        }}
      />
      <StyleControls
        value={document.style}
        onChange={(style) => updateDocument({ ...document, style })}
      />
      <ExportPanel
        filename={filename}
        onFilenameChange={setFilename}
        progress={{ active: busy, label: busy ? '正在生成高精度作品…' : undefined }}
        error={error}
        disabled={!source || projectionValidation.status === 'error'}
        onExportSvg={() => runExport((plan) => downloadSvg(plan, `${basename(filename)}.svg`))}
        onExportPng={() => runExport((plan) => downloadPng(plan, `${basename(filename)}.png`))}
        onExportProject={() => downloadProject(document, `${basename(filename)}.maptool.json`)}
        onImportProject={async (file) => {
          try {
            await loadProject(file, (next) => updateDocument(next));
            setStatus('项目文件已载入');
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
          }
        }}
      />
    </Inspector>
  );

  const preview = (
    <PreviewDrawer
      title="二维投影预览"
      eyebrow={document.projection.id}
      expanded={previewOpen}
      onExpandedChange={setPreviewOpen}
      isBusy={previewPending}
      status={
        previewPending && latestPlan
          ? `实时更新中 · ${latestPlan.lineRuns.length.toLocaleString()} 条线段`
          : latestPlan
            ? `${latestPlan.lineRuns.length.toLocaleString()} 条线段`
            : '等待渲染'
      }
      error={error}
    >
      <ProjectionPreview
        document={previewDocument}
        source={source}
        revision={revision}
        renderFallback={renderFallback}
        onLatestPlanChange={setLatestPlan}
        onPendingChange={setPreviewPending}
        onError={handlePreviewError}
      />
    </PreviewDrawer>
  );

  return (
    <AppShell
      header={
        <div className="product-lockup">
          <strong>MAPTOOL</strong>
          <span>GLOBE / PROJECTION STUDIO</span>
        </div>
      }
      actions={
        <a className="quiet-link" href="?calibration=1">
          校准检查
        </a>
      }
      inspector={inspector}
      preview={preview}
      status={status}
      error={error}
      workspaceLabel="三维地球选区"
    >
      <GlobeViewport
        extent={draftExtent ?? document.extent}
        onExtentChange={(extent) =>
          setDraftExtent({ ...extent, wrapsAntimeridian: extent.west > extent.east })
        }
        onExtentCommit={(extent) => {
          const committed = { ...extent, wrapsAntimeridian: extent.west > extent.east };
          setDraftExtent(null);
          setExtent(committed);
          setRevision((value) => value + 1);
        }}
        onExtentCancel={() => setDraftExtent(null)}
      />
      <div className="workspace-caption" aria-hidden="true">
        <span>拖动八个手柄定义构图范围</span>
        <span>{document.extent.wrapsAntimeridian ? '跨越日期变更线' : '连续经度窗口'}</span>
      </div>
    </AppShell>
  );
}
