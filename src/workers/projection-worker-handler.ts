import { buildRenderPlan } from '../core/render/build-render-plan';
import type { RenderPlan } from '../core/render/render-plan';
import { hashString, stableJson } from '../core/utils/stable-json';
import {
  WORKER_PROTOCOL_VERSION,
  toLoadedSourceMap,
  type ProjectionWorkerRequest,
  type ProjectionWorkerResponse,
} from './protocol';

export interface ProjectionWorkerHandler {
  handle(request: ProjectionWorkerRequest): Promise<ProjectionWorkerResponse | null>;
  clear(): void;
}

export interface ProjectionWorkerHandlerOptions {
  maxCacheEntries?: number;
  now?: () => number;
}

function cacheKey(request: Extract<ProjectionWorkerRequest, { type: 'build' }>): string {
  return hashString(
    stableJson({
      sourceHash: request.document.source.sha256,
      calibration: request.document.source.calibration,
      extent: request.document.extent,
      projection: request.document.projection,
      canvas: request.document.canvas,
      style: request.document.style,
      lodPointCount: request.source.points.length,
      precision: request.precision,
    }),
  );
}

function planForRevision(plan: RenderPlan, revision: number): RenderPlan {
  return plan.revision === revision ? plan : { ...plan, revision };
}

/** Stateful worker core with bounded render cache and stale-revision rejection. */
export function createProjectionWorkerHandler(
  options: ProjectionWorkerHandlerOptions = {},
): ProjectionWorkerHandler {
  const maxCacheEntries = options.maxCacheEntries ?? 12;
  if (!Number.isInteger(maxCacheEntries) || maxCacheEntries < 1) {
    throw new RangeError('Worker cache size must be a positive integer.');
  }

  const planCache = new Map<string, RenderPlan>();
  const cancelledRequests = new Set<number>();
  let latestRevision = -1;

  const clear = () => {
    planCache.clear();
    cancelledRequests.clear();
    latestRevision = -1;
  };

  return {
    clear,
    async handle(request) {
      if (request.type === 'cancel') {
        cancelledRequests.add(request.requestId);
        return null;
      }

      if (request.revision < latestRevision || cancelledRequests.delete(request.requestId))
        return null;
      latestRevision = request.revision;

      try {
        if (request.source.manifest.source.sha256 !== request.document.source.sha256) {
          throw new Error('项目引用的源图哈希与工作线程资产不一致。');
        }
        const key = cacheKey(request);
        const cached = planCache.get(key);
        if (cached) {
          planCache.delete(key);
          planCache.set(key, cached);
          return {
            protocolVersion: WORKER_PROTOCOL_VERSION,
            type: 'result',
            requestId: request.requestId,
            revision: request.revision,
            plan: planForRevision(cached, request.revision),
          };
        }

        const plan = buildRenderPlan(request.document, toLoadedSourceMap(request.source), {
          revision: request.revision,
          precision: request.precision,
          now: options.now,
        });
        if (request.revision < latestRevision || cancelledRequests.delete(request.requestId))
          return null;

        planCache.set(key, plan);
        if (planCache.size > maxCacheEntries) planCache.delete(planCache.keys().next().value!);
        return {
          protocolVersion: WORKER_PROTOCOL_VERSION,
          type: 'result',
          requestId: request.requestId,
          revision: request.revision,
          plan,
        };
      } catch (error) {
        return {
          protocolVersion: WORKER_PROTOCOL_VERSION,
          type: 'error',
          requestId: request.requestId,
          revision: request.revision,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
