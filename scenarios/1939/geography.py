"""Compile the offline physical geography used by the reference atlas style."""
import argparse
import ast
import json
from collections import defaultdict
from pathlib import Path
import shapefile
from shapely.geometry import shape
from shapely import orient_polygons

def coordinates(seq):
    return [[round(x,4),round(y,4)] for x,y in seq]

def compile_geography(source, reference, work):
    def records(file, fields):
        return shapefile.Reader(str(source/file)).iterShapeRecords(fields=fields)
    rivers=defaultdict(list)
    for item in records('ne_10m_rivers_lake_centerlines',['scalerank','featurecla']):
        rank=item.record.scalerank
        if 'Lake Centerline' in item.record.featurecla: continue
        tier=0 if rank<=4 else 1 if rank<=7 else 2
        geom=shape(item.shape.__geo_interface__).simplify(.017 if tier==0 else .024)
        for line in getattr(geom,'geoms',[geom]):
            rivers[tier].append(coordinates(line.coords))
    lakes=defaultdict(list)
    for item in records('ne_10m_lakes',['scalerank','year','featurecla']):
        rank,year,kind=item.record.scalerank,item.record.year,item.record.featurecla
        if (year and year>1938) or 'reservoir' in kind.lower(): continue
        geom=orient_polygons(shape(item.shape.__geo_interface__).simplify(.016),exterior_cw=True)
        for p in getattr(geom,'geoms',[geom]):
            if p.area>.002:
                lakes[0 if rank<=3 else 1 if rank<=6 else 2].append([coordinates(p.exterior.coords),*[coordinates(h.coords) for h in p.interiors]])
    rails=[]
    for item in records('ne_10m_railroads',['scalerank','category']):
        if item.record.scalerank>7 or item.record.category not in (1,2): continue
        geom=shape(item.shape.__geo_interface__).simplify(.028)
        for line in getattr(geom,'geoms',[geom]):
            rails.append(coordinates(line.coords))
    towns=[]
    for item in records('ne_50m_populated_places_simple',['scalerank','name','pop_max']):
        x,y=item.shape.points[0]
        towns.append([round(x,4),round(y,4),item.record.scalerank,item.record.name,item.record.pop_max])
    data={'rivers':[{'type':'MultiLineString','coordinates':rivers[t]} for t in range(3)],
          'lakes':[{'type':'MultiPolygon','coordinates':lakes[t]} for t in range(3)],
          'rails':{'type':'MultiLineString','coordinates':rails},'towns':towns}
    script=(reference/'africa_map/src/render_africa_alt_1910.py').read_text(encoding='utf8')
    locators=next(n for n in ast.parse(script).body if isinstance(n,ast.FunctionDef) and n.name=='locators')
    table=next(n.value for n in locators.body if isinstance(n,ast.Assign) and n.targets[0].id=='positions')
    owners={'British':'GBR','French':'FRA','Portuguese':'PRT','Spanish':'ESP','Neutral':'TROM'}
    data['africanIslands']=[[x,y,owners[owner]] for owner,items in ast.literal_eval(table).items() for name,x,y in items]
    (work/'geography.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    script=(reference/'europe_map/src/label_europe_countries.py').read_text(encoding='utf8')
    table=next(s.value for s in ast.parse(script).body if isinstance(s,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='LABELS' for t in s.targets))
    layout=[]
    for call in table.elts:
        country,text,x,y,size,angle,turn,*optional=[ast.literal_eval(v) for v in call.args]
        kwargs={v.arg:ast.literal_eval(v.value) for v in call.keywords}
        layout.append(dict(country=country,text=text,x=x,y=y,size=size,angle=angle,turn=turn,
                           tracking=optional[0] if optional else .16,leader=kwargs.get('leader',[])))
    (work/'reference-labels.json').write_text(json.dumps(layout,ensure_ascii=False),encoding='utf8')
    print('River, lake, rail and place counts:',sum(map(len,rivers.values())),sum(map(len,lakes.values())),len(rails),len(towns))

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('source',type=Path)
    parser.add_argument('reference',type=Path)
    parser.add_argument('work',type=Path)
    args=parser.parse_args()
    compile_geography(args.source,args.reference,args.work)
