import type { RenderLineRun, RenderPlan } from './render-plan';

function applyStrokeStyle(context: CanvasRenderingContext2D, run: RenderLineRun, plan: RenderPlan) {
  const { style } = plan;
  if (run.layer === 'graticule') {
    context.strokeStyle = style.graticuleColor;
    context.lineWidth = style.graticuleWidth;
    context.globalAlpha = style.graticuleOpacity;
  } else if (run.layer === 'extent-frame') {
    context.strokeStyle = style.extentColor;
    context.lineWidth = style.extentWidth;
    context.globalAlpha = 1;
  } else {
    context.strokeStyle = style.lineColor;
    context.lineWidth = style.lineWidth;
    context.globalAlpha = style.lineOpacity;
  }
  context.lineCap = style.lineCap;
  context.lineJoin = style.lineJoin;
}

export function drawRenderPlan(context: CanvasRenderingContext2D, plan: RenderPlan) {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, plan.width, plan.height);
  if (plan.style.background) {
    context.fillStyle = plan.style.background;
    context.globalAlpha = 1;
    context.fillRect(0, 0, plan.width, plan.height);
  }

  for (const run of plan.lineRuns) {
    if (run.points.length < 2) continue;
    applyStrokeStyle(context, run, plan);
    context.beginPath();
    context.moveTo(run.points[0]!.x, run.points[0]!.y);
    for (let index = 1; index < run.points.length; index += 1) {
      const point = run.points[index]!;
      context.lineTo(point.x, point.y);
    }
    if (run.closed) context.closePath();
    context.stroke();
  }
  context.restore();
}
