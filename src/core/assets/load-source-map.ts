import type { LoadedSourceMap, SourceMapManifest } from '../../types/source-map';

const cache = new Map<string, Promise<LoadedSourceMap>>();

export function loadSourceMap(lod: 'globe' | 'detail'): Promise<LoadedSourceMap> {
  const cached = cache.get(lod);
  if (cached) return cached;

  const request = (async () => {
    const manifestResponse = await fetch('/generated/source-map.manifest.json');
    if (!manifestResponse.ok) throw new Error('无法加载源图清单。');
    const manifest = (await manifestResponse.json()) as SourceMapManifest;
    const lodInfo = manifest.lods[lod];
    const dataResponse = await fetch(`/generated/${lodInfo.file}`);
    if (!dataResponse.ok) throw new Error(`无法加载 ${lod} 线稿数据。`);
    const buffer = await dataResponse.arrayBuffer();
    if (buffer.byteLength % 8 !== 0) throw new Error('源图二进制长度无效。');
    const points = new Float32Array(buffer);
    if (points.length / 2 !== lodInfo.pointCount) throw new Error('源图点数与清单不一致。');
    return { manifest, points };
  })();

  cache.set(lod, request);
  return request;
}
