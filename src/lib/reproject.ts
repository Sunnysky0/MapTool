import { geoPath, geoRotation, type GeoProjection } from 'd3-geo';
import type { TexturePixels } from './mapTexture';
import { MapPath } from './canvas';
import { getProjectionDef } from './projections';
import type { ProjectionId } from '../types';
import type { RenderInput } from './render';

const wrap = (d: number) => d - 360 * Math.floor((d + 180) / 360);
type Point = [number, number];

const outlines = new Map<ProjectionId, Path2D>();

export function unitOutline(id: ProjectionId) {
  let outline = outlines.get(id);
  if (!outline) {
    const projection = getProjectionDef(id).factory().rotate([0,0,0]).center([0,0]).angle(0)
      .translate([0,0]).scale(100).precision(.025);
    // Lambert's cone extends to infinity at the opposite pole. The finite bounds
    // cover the editor's entire latitude/zoom range and keep its silhouette small.
    if (id === 'lambertEurope') projection.clipExtent([[-10000,-10000],[10000,10000]]);
    const path = new MapPath();
    geoPath(projection, path)({type:'Sphere'});
    outline = path;
    outlines.set(id, outline);
  }
  return outline;
}

export function rasterPreview() {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  let image: ImageData, target: Uint32Array;

  return (dest: CanvasRenderingContext2D, input: RenderInput, projection: GeoProjection,
    world: TexturePixels, region?: TexturePixels, padded = false) => {
    // Interpolate inverse-projected coordinates within small screen cells. Longitude
    // is unwrapped per cell, so the date line never samples the opposite hemisphere.
    const {width, height, config} = input;
    const ratio = Math.min(1, 480 / Math.max(width, height));
    const w = Math.max(1, Math.round(width * ratio)), h = Math.max(1, Math.round(height * ratio));
    if (!image || canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      image = ctx.createImageData(w, h);
      target = new Uint32Array(image.data.buffer);
    }
    const step = 16, columns = Math.ceil(w / step);
    const invert = projection.invert!;
    const row = (y: number) => Array.from({length: columns + 1}, (_, i) =>
      invert([Math.min(w, i * step) * width / w, y * height / h]) ?? [NaN, NaN] as Point);
    let top = row(0);
    for (let y = 0; y < h; y += step) {
      const dy = Math.min(step, h-y);
      const bottom = row(y+dy);
      for (let i = 0; i < columns; i++) {
        const x = i * step, dx = Math.min(step, w-x);
        const a = top[i], b = top[i+1], c = bottom[i], d = bottom[i+1];
        const lon = a[0], bx = wrap(b[0]-lon), cx = wrap(c[0]-lon), ex = wrap(d[0]-lon);
        let texture = world;
        if (region) {
          const spec = region.spec, u = wrap(lon-spec.lon), halfLat = spec.span * spec.height / spec.size / 2;
          if (Math.max(Math.abs(u), Math.abs(u+bx), Math.abs(u+cx), Math.abs(u+ex)) < spec.span/2 &&
              Math.max(Math.abs(a[1]-spec.lat), Math.abs(b[1]-spec.lat), Math.abs(c[1]-spec.lat), Math.abs(d[1]-spec.lat)) < halfLat) texture = region;
        }
        const {size, height: th, lon: center, lat, span} = texture.spec;
        const scale = size / span;
        const u0 = size/2 + wrap(lon-center)*scale;
        const v0 = th/2 + (lat-a[1])*scale;
        for (let j = 0; j < dy; j++) {
          const f = (j+.5)/dy;
          const du = ((1-f)*bx + f*(ex-cx))*scale/dx;
          const dv = ((1-f)*(a[1]-b[1]) + f*(c[1]-d[1]))*scale/dx;
          let u = u0 + f*cx*scale + .5*du, v = v0 + f*(a[1]-c[1])*scale + .5*dv;
          let out = (y+j)*w+x;
          for (let k = 0; k < dx; k++, u += du, v += dv) {
            // Texture widths are powers of two. Wrapping also handles seam-crossing cells.
            target[out++] = texture.pixels[(Math.floor(u) & (size-1)) + Math.min(th-1, Math.max(0, v | 0))*size];
          }
        }
      }
      top = bottom;
    }
    ctx.putImageData(image, 0, 0);
    dest.save();
    const inset = !padded && config.scenario && (config.atlasSheet === 'europe' ? width*7.2/583.56 : config.atlasSheet === 'africa' ? width*.008 : 0);
    if (inset) {
      dest.beginPath(); dest.rect(inset, inset, width-2*inset, height-2*inset); dest.clip();
    }
    // Inversion alone cannot distinguish pixels outside a projection's horizon.
    const origin = projection(geoRotation(projection.rotate()).invert([0,0]))!;
    const transform = dest.getTransform();
    dest.translate(origin[0], origin[1]);
    dest.rotate(-projection.angle()*Math.PI/180);
    dest.scale(projection.scale()/100, projection.scale()/100);
    dest.clip(unitOutline(config.view.projection));
    dest.setTransform(transform);
    dest.drawImage(canvas, 0, 0, width, height);
    dest.restore();
  };
}
