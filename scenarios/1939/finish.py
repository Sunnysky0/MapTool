"""Simplify shared arcs once and verify the released planar coverage."""
import argparse
import json
import subprocess
from pathlib import Path
from shapely import coverage_is_valid
from shapely.geometry import shape

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('work',type=Path)
parser.add_argument('mapshaper',type=Path,help='path to mapshaper/bin/mapshaper')
args = parser.parse_args()
work = args.work.resolve()
def mapshaper(*options):
    subprocess.run(['node',args.mapshaper,*options],check=True)

draft=work/'simplified.topo.json'
final=work/'world.topo.json'
mapshaper(work/'units.geojson','-clean','gap-fill-area=0','-explode','-simplify','variable',
          'percentage=$.area<3e8?1:0.42','keep-shapes','-dissolve','unit','-clean','gap-fill-area=0',
          '-o','force','format=topojson','quantization=360000001',draft)
# Noding again on the final integer grid eliminates sub-grid intersections
# at the T junctions of reconstructed and historical borders.
mapshaper(draft,'-clean','gap-fill-area=0','-o','force','quantization=360000001','format=topojson',final)
geo=work/'coverage.geojson'
mapshaper(final,'-o','force','format=geojson',geo)
features=json.loads(geo.read_text(encoding='utf8'))['features']
geometry=[shape(f['geometry']) for f in features]
assert all(p.is_valid for p in geometry)
assert coverage_is_valid(geometry), 'Polygon coverage contains overlapping or mismatched edges'
subprocess.run(['node',HERE/'pack.mjs',work],check=True)
subprocess.run(['node',HERE/'verify.mjs'],check=True)
