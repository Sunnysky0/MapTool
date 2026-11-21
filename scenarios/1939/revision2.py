"""Apply the reference atlas to the common NE land partition before topology."""
import argparse
import json
import sqlite3
from collections import defaultdict
from pathlib import Path

import shapefile
from shapely import from_wkb, union_all, orient_polygons
from shapely.geometry import box, shape, mapping, GeometryCollection, Point
from build import clean, parts, dump, DEST
from boundaries import polygon

# Source units disappear from both the published gazetteer and the topology.
# Distinct administrations sharing a color (e.g. Uganda and Kenya) keep IDs.
MERGES = {
    'IND':'HYD MYSO KASH RAJP CIND PUNJ BALU WESTIND SINDST IBEN IMAD IBOM IUNI IBIH IORI IASM ICP IPUN ISIN INWF IBAL',
    'RUS':'KUB TEREK DAG KAL TAT BASH CHUV KOMI BURY YAK CHECH ING OSN KABAR',
    'GEO':'ABK ADJ OSS', 'AZE':'NAKH KARA', 'TURK':'FERG KOK ANDIJ OSH',
    'DEU':'SVN', 'BALTD':'EST LVA', 'SAU':'NEJD HEJ ASIR SHAM HASA',
    'OTT':'SYR LEB BEIR PAL-E IRAQ KURD MOSUL BAGH BASR ALEP DAMA VANP BITL DIYA YEM TIH',
    'OMAN':'IMAM', 'ADEN':'WAD EAD',
    'ALG':'ALG-N ALG-S', 'SUD':'NILE KORD EQUA DAR', 'BCON':'LOWC EQC ORIC KASAI KAT',
    'LIB':'TRIP CYRE FEZ', 'GOLD':'GCOAST ASH GNORTH','UGA':'BUG BUN TORO ANK','KEN':'KCOAST',
    'SAF':'CAPE NATAL TRAAL ORAN', 'GEA':'TANG RWA BDI','LBR':'LIBCO LIBIN','MOZ':'MANIC',
    'EGY':'CAIRO SUEZ PSAID ISMAIL SUEZCITY', 'NSOUTH':'LAG', 'USN':'FSUD NER VOL', 'USC':'UBAN CHAD', 'FMOR':'TARF',
}

def ref_features(path):
    return json.loads(path.read_text(encoding='utf8'))['features']

def gpkg_geometry(blob):
    envelope = (blob[3] >> 1) & 7
    return from_wkb(blob[8 + [0,32,48,48,64][envelope]:])

def revise(source, reference, work):
    units=json.loads((work/'base-gazetteer.json').read_text(encoding='utf8'))
    extra=json.loads((work/'base-inputs.json').read_text(encoding='utf8'))
    basis={k:set(v) for k,v in extra['bases'].items()}
    land={f['properties']['unit']:shape(f['geometry']) for f in ref_features(work/'base.geojson')}
    def new(uid,name,parent,status,capital,seat,manager=None):
        units[uid]=dict(id=uid,name=name,parent=parent,status=status,capital=capital,seat=seat,
                        sovereign=units[parent]['sovereign'] if parent else uid,manager=manager or uid)
    new('SAU','沙特阿拉伯王国',None,'主权国家','利雅得',[46.68,24.69])
    new('BALTD','波罗的联合大公国',None,'主权国家','里加',[24.11,56.95])
    new('USN','上塞内加尔与尼日尔','FWA','殖民地','巴马科',[-8,12.65])
    new('USC','乌班吉沙里—乍得','FEA','殖民地','班吉',[18.56,4.37])
    new('NRHE','东北罗得西亚','NRHO','保护领','詹姆森堡',[32.65,-13.64])
    new('NRHW','巴罗策兰—西北罗得西亚','NRHO','保护领','利文斯通',[25.85,-17.85])
    new('PAL-E','外约旦','OTT','辖区','安曼',[35.93,31.95])
    new('TROM','特罗梅兰岛',None,'归属未定',None,None,'UNALLOC')
    regions={f['properties']['id']:shape(f['geometry']) for f in ref_features(reference/'africa_map/exports/africa_alt_1910_regions.geojson')}
    country_codes={'SAU','JOR','ISR','ITA','SVN'}
    countries={r.record[0]:clean(shape(r.shape.__geo_interface__)) for r in
               shapefile.Reader(str(source/'ne_10m_admin_0_map_units')).iterShapeRecords(fields=['GU_A3']) if r.record[0] in country_codes}
    codes={'FR-67','FR-68','FR-57','IT-TS','HR-18'}
    admin={r.record[0]:clean(shape(r.shape.__geo_interface__)) for r in
           shapefile.Reader(str(source/'ne_10m_admin_1_states_provinces')).iterShapeRecords(fields=['iso_3166_2']) if r.record[0] in codes}
    assert set(admin)==codes
    def transfer(to, sources, mask):
        mask=clean(mask)
        pieces=[]
        for uid in sources:
            if uid==to or uid not in land or not land[uid].intersects(mask): continue
            pieces.append(clean(land[uid].intersection(mask)))
            land[uid]=clean(land[uid].difference(mask))
        if pieces:
            land[to]=clean(union_all([land.get(to,GeometryCollection()),*pieces]))
    # 1871 imperial territory. Today's three French departments exclude Belfort,
    # Nancy and the rest of Lorraine. Preserve Croatian offshore islands and Rijeka.
    transfer('DEU',['FRA'],union_all([admin[k] for k in ['FR-67','FR-68','FR-57']]))
    transfer('DEU',['ITA'],admin['IT-TS'])
    istria=max(parts(admin['HR-18']),key=lambda p:p.area)
    coast=polygon('13.48,45.62 14.02,45.59 14.30,45.44 14.34,45.36 14.32,45.31 14.30,45.22 14.25,45.10 14.19,44.98 14.03,44.70 13.75,44.72')
    # Restore Croatia's mainland outside the new peninsula from the former Italian cut.
    transfer('HRV',['ITA'],box(13.35,44.65,14.6,45.67).difference(countries['ITA']).difference(countries['SVN']))
    transfer('DEU',['HRV','ITA'],union_all([istria,coast]).difference(countries['ITA']))
    transfer('DEU',['ITA'],countries['SVN'])
    basis.setdefault('DEU',set()).update(['FR-57','FR-67','FR-68','SVN','IT-TS','伊斯特拉半岛陆地'])
    transfer('PAL-E',['PAL'],countries['JOR'])
    with sqlite3.connect(reference/'east_asia_map/data/levant_disputed_naturalearth.gpkg') as db:
        disputed=union_all([gpkg_geometry(row[0]) for row in db.execute('SELECT geom FROM disputed')])
    transfer('OTT',['PAL'],disputed)
    units['PAL'].update(name='巴勒斯坦托管领',status='国际托管领',parent=None,sovereign='PAL',manager='PALCOM',
                        note='约旦河以西及加沙的国际托管领；1938 参考设定未指定受托国或托管机构名称。')
    units['OTT'].update(name='奥斯曼崇高国',note='安纳托利亚、东色雷斯、黎凡特、外约旦及美索不达米亚连为主体。也门北部依参考图归奥斯曼。')
    units['IRN']['name']='伊朗帝国'
    units['POL']['name']='波兰摄政王国'
    units['LTU'].update(name='立陶宛公国',capital='维尔纽斯',seat=[25.28,54.69])
    units['DEU']['note']='帝国辖阿尔萨斯–洛林、斯洛文尼亚、的里雅斯特和伊斯特拉半岛。波希米亚仍为王冠监护属邦。'
    for uid,name in [('GEO','格鲁吉亚自治共和国'),('ARM','亚美尼亚自治共和国'),('AZE','阿塞拜疆自治共和国')]:
        units[uid].update(name=name,parent='RUS',sovereign='RUS',status='自治共和国')
    for uid in ['NNORTH','NSOUTH']:
        units[uid]['name']='北尼日利亚' if uid=='NNORTH' else '南尼日利亚'
    units['KEN']['name']='英属东非保护领'
    units['KEN']['status']='保护领'
    # Preserve legal relationships when removing an intermediate administration.
    units['WALV']['parent']='SAF'
    units['MAHR']['parent']='ADEN'
    remap={uid:to for to,ids in MERGES.items() for uid in ids.split()}
    remap['NRHO']='NRHW'  # default in the original footprint, before splitting it
    land['NRHW']=land.pop('NRHO')
    for dest,children in MERGES.items():
        pieces=[land.pop(k) for k in children.split() if k in land]
        if pieces:
            land[dest]=clean(union_all([land.get(dest,GeometryCollection()),*pieces]))
        target_basis=basis.setdefault(dest,set())
        for uid in children.split():
            target_basis.update(basis.pop(uid,set()))
            del units[uid]
    # Restore the entire Saudi map unit including its Red Sea islands. The
    # reference 1938 Arab coastal polygons settle the Yemen–Aden division.
    transfer('SAU',['EGY','OTT','ADEN','OMAN'],countries['SAU'])
    straits=box(34.46,27.89,34.75,28.03)
    red_sea_islands=[p for p in parts(land['EGY']) if straits.covers(p)]
    transfer('SAU',['EGY'],union_all(red_sea_islands))
    transfer('OTT',['ADEN'],regions['Context-Ottoman-Empire'].intersection(box(40,12,51,20)))
    transfer('ADEN',['OTT'],regions['Context-British-Protectorate'].intersection(box(40,12,54,20)))
    # Transfer across modern admin-0 borders inside each reference footprint.
    # The separately established Kamerun, Kionga and Walvis Bay polygons stay
    # outside these pools. No crop edge from a regional sheet can become a coast.
    families=[
        {'ALG':'French-Algeria','EGY':'British-Egypt','LIB':'Italian-Libya','TUN':'French-Tunisia',
         'FMOR':'Morocco','SMOR':'Spanish-Morocco','SAG':'Saguia-el-Hamra','RIO':'Rio-de-Oro',
         'SUD':'Anglo-Egyptian-Sudan','USN':'Upper-Senegal-and-Niger','MRT':'Mauritania',
         'SEN':'Senegal','GIN':'French-Guinea','CIV':'Ivory-Coast','DAH':'Dahomey',
         'USC':'Ubangi-Shari-Chad','GAB':'French-Gabon','MCON':'Middle-Congo','GOLD':'Gold-Coast',
         'NNORTH':'Northern-Nigeria','NSOUTH':'Southern-Nigeria'},
        {'NRHE':'North-Eastern-Rhodesia','NRHW':'North-Western-Rhodesia'},
        {'KEN':'East-Africa-Protectorate','UGA':'Uganda','ISOM':'Italian-Somaliland-combined',
         'BSOM':'British-Somaliland','SUD':'Anglo-Egyptian-Sudan','ERI':'Italian-Eritrea','ETH':'Ethiopia','DJI':'French-Somaliland'}
    ]
    for family in families:
        for uid,ref in family.items():
            transfer(uid,family.keys(),regions[ref])
            basis.setdefault(uid,set()).add('1938 非洲图 · '+ref)
    transfer('TROM',['FSOU','MAD','MUS','REU'],regions['Tromelin-uncertain'])
    basis['TROM']={'1938 非洲图 · Tromelin-uncertain'}
    basis.setdefault('PAL',set()).update(['约旦河西岸与加沙','剔除戈兰与舍巴农场'])
    basis.setdefault('SAU',set()).update(['SAU 现行边界','蒂朗、塞纳菲尔岛及法拉桑群岛'])
    units['IND']['note']='印度、巴基斯坦、孟加拉及克什米尔合绘为一个政区。'
    units['CRIM']['note']='俄方实际管理，乌克兰主张。'
    for uid,u in units.items():
        assert not u['parent'] or u['parent'] in units,(uid,u['parent'])
        assert u['sovereign'] in units,(uid,u['sovereign'])
    # Standalone labels can survive the administrative merger (e.g. ports).
    group_owner={'tiran':'SAU','sanafir':'SAU','farasan':'SAU','kamaran':'OTT','hanish':'OTT','zuqar':'OTT'}
    for g in extra['groups']:
        g['unit']=group_owner.get(g['id'],remap.get(g['unit'],g['unit']))
        assert g['unit'] in units,g
    extra['groups'].append(dict(id='tromelin',name='特罗梅兰岛',unit='TROM',at=[54.52,-15.89],radius=.1))
    extra['bases']={k:sorted(v) for k,v in basis.items() if k in units}
    extra['referencePalette']=json.loads((reference/'europe_map/data/hoi_inspired_palette.json').read_text(encoding='utf8'))['themes']
    extra['referencePalette'].update(json.loads((reference/'north_america_map/data/north_america_palette.json').read_text(encoding='utf8'))['themes'])
    extra['referencePalette'].update(json.loads((reference/'africa_map/data/africa_palette.json').read_text(encoding='utf8'))['themes'])
    features=[{'type':'Feature','properties':{'unit':uid},'geometry':mapping(orient_polygons(g,exterior_cw=True))}
              for uid,g in land.items() if not g.is_empty]
    dump(work/'units.geojson',{'type':'FeatureCollection','features':features})
    dump(work/'inputs.json',extra)
    dump(DEST/'gazetteer.json',units)
    print(f'Revision 2: {len(units)} units, {len(features)} polygon units',flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    for arg in ['source','reference','work']: parser.add_argument(arg,type=Path)
    args=parser.parse_args()
    revise(args.source,args.reference,args.work)
