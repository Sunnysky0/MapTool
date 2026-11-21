"""Compile the editable gazetteer and land transfers. See README.md for inputs."""
import argparse
import json
from collections import defaultdict
from pathlib import Path
import shapefile
from shapely import make_valid, set_precision, union_all, orient_polygons
from shapely.geometry import Polygon, shape, mapping, box, LineString
from boundaries import reconstruct, polygon

HERE = Path(__file__).resolve().parent
DEST = HERE.parents[1] / 'src' / 'scenarios' / '1939'
GRID = .00001


def lines(filename):
    for line in (HERE / filename).read_text(encoding='utf8').splitlines():
        if line.strip() and not line.startswith('#'):
            yield line.strip()


def parts(g):
    if g.is_empty:
        return []
    if g.geom_type == 'Polygon':
        return [g]
    return [p for item in getattr(g, 'geoms', []) for p in parts(item)]


def clean(g):
    if not g.is_valid:
        g = make_valid(g)
    return set_precision(union_all(parts(g)), GRID)


def dump(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf8')


def catalog():
    units, owners, groups = {}, {}, []
    for line in lines('units.txt'):
        if line.startswith('@'):
            parent, status = line[1:].split('|')
            continue
        uid, name, capital, loc, codes = (line.split('|') + [''] * 4)[:5]
        assert uid not in units, uid
        sovereign = units[parent]['sovereign'] if parent else uid
        units[uid] = dict(id=uid, name=name, capital=capital or None, status=status,
                          sovereign=sovereign, parent=parent or None, manager=uid)
        if loc:
            units[uid]['seat'] = list(map(float, loc.split(',')))
        for code in codes.split():
            assert code not in owners, code
            owners[code] = uid
    for row in lines('islands.txt'):
        uid, items = row.split('|')
        for item in items.strip().split(';'):
            gid, name, x, y, radius = item.split()
            groups.append(dict(id=gid, name=name, unit=uid, at=[float(x), float(y)], radius=float(radius)))
    return units, owners, groups


def political_details(units):
    for u in units.values():
        if u['status'] in ['保护国','藩属','半自治联盟','羁縻地区','王冠监护属邦','保护酋长国','共同保护国']:
            u['suzerain'] = u['sovereign']
    for uid, manager in {
        'HAW':'USA','CRIM':'RUS','CYP':'GBR','NWD':'NWCO','BIN':'ROC','MNLPORT':'PORTBOARD',
        'INTRA':'SPORT','SHINT':'SMC','SHFR':'FRA','TJGB':'GBR','TJFR':'FRA','TJJP':'JPN',
        'TJIT':'ITA','TJDE':'DEU','TJAU':'GAT','TJBE':'BEL','TJRU':'RUS','TJUS':'USA',
        'CANAL':'USA','KWAN':'FRA','KIAO':'DEU','CAIRO':'COLONIAL','SUEZ':'COLONIAL',
        'KANT':'ANGLOUS','VAN':'ANGLOFR','SUD':'ANGLOEG','DAR':'ANGLOEG','TANGI':'TANGCOM',
        'HNT':'HKG','ESS':'GBR','AMZ':'PER','ATA':'UNALLOC','NBOR':'BNBC',
        'PSAID':'COLONIAL','ISMAIL':'COLONIAL','SUEZCITY':'COLONIAL'
    }.items():
        units[uid]['manager'] = manager
    for uid in ('NWP','NWS','NWY','NWM','NWA'):
        units[uid]['manager'] = 'NWCO'
    units['HNT']['sovereign'] = 'ROC'
    for uid in ('SUD','DAR','NILE','KORD','EQUA'):
        units[uid]['coSovereigns']=['GBR','EGY']
    units['VAN']['coSovereigns']=['GBR','FRA']
    units['KANT']['coSovereigns']=['GBR','USA']
    units['HAW'].update(guarantors=['GBR','USA','ROC','JPN'],note='英、美、中、日四国公约保障中立，美国受委任管理。')
    for uid,claims in {'CRIM':['UKR'],'ESS':['VEN'],'FLK':['ARG'],'AMZ':['ECU'],'KANT':['GBR','USA']}.items():
        units[uid]['claims'] = claims
    units['ISL']['note'] = '与丹麦共戴君主。'
    units['DANZ']['note'] = '德国港口，波兰享有铁路过境及通商权。'
    units['BAA']['note'] = '查尔斯顿与伦敦正推进二元帝国法案。'
    units['BOH']['note'] = '波希米亚、摩拉维亚与奥属西里西亚受德意志王冠监护。'
    units['VNM']['note'] = '与中华共和国结盟。'
    units['PHL']['note'] = '由中华共和国扶植建立的独立共和国。'
    units['BLR']['note'] = '《桦树条约》成员。'
    units['INTRA']['note'] = '吕宋保有主权，城墙内为非军事化国际赛场。'
    units['ATA']['note'] = '主权未定。扇区线与彼得一世岛标注仅表示截至元旦已公布的主张。'


def compile_atlas(source, work):
    units, owners, groups = catalog()
    political_details(units)
    reader = lambda name: shapefile.Reader(str(source / ('ne_10m_' + name)), encoding='utf8')
    geom = {}
    bases = defaultdict(set)
    country = {r.record.GU_A3: clean(shape(r.shape.__geo_interface__)) for r in reader('admin_0_map_units').iterShapeRecords()}
    assert set(country) == set(owners), (set(country)-set(owners), set(owners)-set(country))
    history = {f['properties']['NAME']: clean(shape(f['geometry'])) for f in
               json.loads((source / 'world_1914.geojson').read_text(encoding='utf8'))['features'] if f['properties']['NAME']}
    def add(uid, g):
        assert uid in units, uid
        if not g.is_empty:
            geom[uid] = clean(geom[uid].union(g)) if uid in geom else clean(g)

    # Work on each map unit's actual footprint. A mask can only transfer a piece
    # currently owned by its source, including its original coastline and holes.
    rules = []
    codes = set()
    direct = {
        'IBEN':'IN-WB', 'IMAD':'IN-TN IN-AP IN-KL IN-KA', 'IBOM':'IN-MH IN-GJ',
        'IUNI':'IN-UP IN-UT', 'IBIH':'IN-BR IN-JH', 'IORI':'IN-OR', 'IASM':'IN-AS IN-NL IN-ML IN-MZ',
        'ICP':'IN-MP IN-CT','IPUN':'IN-PB IN-HR IN-CH IN-HP PK-PB PK-IS',
        'ISIN':'PK-SD', 'INWF':'PK-KP PK-TA','IBAL':'PK-BA'
    }
    for selectors in direct.values():
        codes.update(selectors.split())
    for line in lines('provinces.txt'):
        target, sources, ids = line.split('|')
        ids = ids.split()
        codes.update(ids)
        rules.append((target,sources.split(),ids))
    provinces = defaultdict(list)
    for record in reader('admin_1_states_provinces').iterShapeRecords(fields=['iso_3166_2']):
        key = record.record[0]
        if key in codes:
            provinces[key].append(clean(shape(record.shape.__geo_interface__)))
    assert codes <= provinces.keys(), codes-provinces.keys()
    for target, sources, ids in reversed(rules):
        mask = union_all([g for key in ids for g in provinces[key]])
        for key in sources:
            g = country[key]
            piece = clean(g.intersection(mask))
            if not piece.is_empty:
                add(target,piece)
                country[key] = clean(g.difference(mask))
        bases[target].update(ids)
    for key,g in country.items():
        add(owners[key],g)
        bases[owners[key]].add(key)

    def move(target,sources,mask):
        mask = clean(mask)
        for uid in sources.split():
            assert uid in units,uid
            g = geom.get(uid)
            if g is None or not g.intersects(mask):
                continue
            piece = clean(g.intersection(mask))
            if not piece.is_empty:
                geom[uid] = clean(g.difference(mask))
                add(target,piece)
        bases[target].add('情景定界')

    def island(target,sources,predicate):
        for uid in sources.split():
            selected, keep = [], []
            for p in parts(geom.get(uid,Polygon())):
                pt = p.representative_point()
                (selected if predicate(pt.x,pt.y) else keep).append(p)
            if selected:
                geom[uid] = union_all(keep)
                add(target,union_all(selected))
                bases[target].add('岛链重分')
    reconstruct(move,history,island)
    for uid,selectors in direct.items():
        move(uid,'IND',union_all([g for k in selectors.split() for g in provinces[k]]))
        bases[uid].update(selectors.split())
    move('IBEN','IND',country['BGD'])
    move('TUSH','OM',box(82,40,123,55))
    move('DAMA','SYR',box(30,30,44,39))
    move('DIYA','KURD',box(35,34,48,43))
    for uid,x,y in [('PSAID',32.30,31.25),('ISMAIL',32.27,30.60),('SUEZCITY',32.54,29.97)]:
        move(uid,'SUEZ EGY',box(x-.035,y-.035,x+.035,y+.035))
    # The Philippine free port also includes the basin outside the NE shoreline.
    port = polygon('120.9490,14.6023 120.9548,14.6063 120.9641,14.6020 120.9661,14.5971 120.9643,14.5925 120.9681,14.5868 120.9655,14.5805 120.9580,14.5814 120.9518,14.5902')
    move('MNLPORT','PHL',port)
    add('MNLPORT',port)
    # Keep the Great Lakes as water and retain the international lake border.
    lakes = [(r.record.name,clean(shape(r.shape.__geo_interface__))) for r in reader('lakes').iterShapeRecords(fields=['name'])
             if r.record.name in ('Lake Superior','Lake Michigan','Lake Huron','Lake Erie','Lake Ontario','Lake St. Clair','Lake Victoria','Lake Tanganyika','Lake Baikal','Lake Ladoga','Lake Titicaca','Lake Balkhash','Caspian Sea','Lake Winnipeg','Great Slave Lake','Great Bear Lake')]
    features, waterlines = [], []
    for name,lake in lakes:
        for uid in ('USA','QUE') if name in ('Lake Superior','Lake Huron','Lake Erie','Lake Ontario','Lake St. Clair') else ():
            if uid == 'QUE':
                boundary = geom['USA'].boundary.intersection(geom[uid].boundary).intersection(lake)
                if not boundary.is_empty:
                    waterlines.append(mapping(boundary))
        for uid,g in list(geom.items()):
            if g.intersects(lake):
                geom[uid] = clean(g.difference(lake))
    for uid,g in geom.items():
        if not g.is_empty:
            features.append(dict(type='Feature', properties={'unit':uid},geometry=mapping(orient_polygons(g,exterior_cw=True))))
    # Keep a single line through the lakes after the Michigan transfer.
    if not waterlines:
        waterlines.append(mapping(LineString([(-89.57,47.99),(-88.36,48.31),(-86.52,47.55),(-84.86,46.91)])))
    dump(work/'base.geojson',dict(type='FeatureCollection',features=features))
    extras = dict(waterlines=waterlines,groups=groups,bases={k:sorted(v) for k,v in bases.items()})
    dump(work/'base-inputs.json',extras)
    print(f'{len(units)} records, {len(features)} polygon units, {len(groups)} named island groups, {len(lakes)} lakes.',flush=True)
    dump(work/'base-gazetteer.json',units)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source',type=Path)
    parser.add_argument('work',type=Path)
    args = parser.parse_args()
    args.work.mkdir(parents=True,exist_ok=True)
    compile_atlas(args.source,args.work)
