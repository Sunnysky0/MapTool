export interface RenderPoint {
  x: number;
  y: number;
}

export interface RenderLineRun {
  layer: 'map-linework' | 'graticule' | 'extent-frame';
  sourceLayer?: 'land' | 'lake';
  countryCode?: string;
  sourcePathId?: string;
  points: RenderPoint[];
  closed?: boolean;
}

export interface RenderWarning {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

export interface RenderStyle {
  lineColor: string;
  lineWidth: number;
  lineOpacity: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  background: string | null;
  graticuleColor: string;
  graticuleWidth: number;
  graticuleOpacity: number;
  extentColor: string;
  extentWidth: number;
}

export interface RenderPlan {
  revision: number;
  width: number;
  height: number;
  projectionId: string;
  sourceHash: string;
  boundary: RenderPoint[];
  lineRuns: RenderLineRun[];
  style: RenderStyle;
  warnings: RenderWarning[];
  stats: {
    inputPoints: number;
    outputPoints: number;
    elapsedMs: number;
  };
}
