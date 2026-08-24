export {
  PROJECTION_CATALOG,
  createD3Projection,
  getProjectionMetadata,
  isProjectionId,
} from './catalog';
export { autoProjectionCenter, createProjection, validateProjectionId } from './create-projection';
export { densifyProjectedPolyline } from './densify';
export {
  WEB_MERCATOR_MAX_LATITUDE,
  antipodeOf,
  assertProjectionValid,
  validateProjection,
} from './validation';
export type * from './types';
export type { DensifyOptions, DensifyResult, DensifyStats, ProjectedPoint } from './densify';
