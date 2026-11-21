import { useState } from 'react';
import { Crosshair, RotateCcw, Search } from 'lucide-react';
import type { AtlasSheet, LabelEdit, LayerData, MapConfig } from '../types';
import { scenarioKey } from '../lib/data';
import { atlasSheet, ATLAS_SHEETS, defaultConfig, historicalConfig, SCENARIO_1939 } from '../lib/presets';
import { territoryColor } from '../scenarios/colors';
import { Button, ColorField, NumberField, Row, Section, Segmented, Toggle } from './ui';

interface Props {
  config: MapConfig;
  data: Record<string,LayerData|undefined>;
  update: (fn:(c:MapConfig)=>MapConfig,transient?:boolean)=>void;
  replace: (c:MapConfig)=>void;
  commit: ()=>void;
}
const field='w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-amber-400/60';
export default function ScenarioPanel({config,data,update,replace,commit}:Props) {
  const [search,setSearch]=useState('');
  const [chosen,setChosen]=useState('ROC');
  const [chosenLabel,setChosenLabel]=useState('');
  const atlas=config.scenario?data[scenarioKey(config.scenario)]?.scenario:undefined;
  const term=search.trim().toLocaleLowerCase();
  const matches=atlas?Object.values(atlas.units).filter(u=>[u.name,u.id,u.capital??''].some(s=>s.toLocaleLowerCase().includes(term))||
    (term && atlas.labels.some(l=>l.unit===u.id&&l.text.includes(term)))):[];
  const unit=matches.find(u=>u.id===chosen)??matches[0];
  const labels=atlas?.labels.filter(l=>l.unit===unit?.id)??[];
  const label=labels.find(l=>l.id===chosenLabel)??(term?labels.find(l=>l.text.includes(term)):undefined)??labels.find(l=>l.kind==='name')??labels[0];
  const edit=label?config.labelEdits[label.id]??{}:{};
  const describe=(id:string)=>atlas?.units[id]?.name??atlas?.managers[id]??id;
  function editLabel(patch:LabelEdit,transient=false) {
    if (label) update(c=>({...c,labelEdits:{...c.labelEdits,[label.id]:{...c.labelEdits[label.id],...patch}}}),transient);
  }
  return <>
    <Section title="情景预设">
      <select aria-label="情景预设" className={field} value={config.scenario?.revision===1?'original':config.scenario?.id??''} onChange={e=>replace(e.target.value?historicalConfig():defaultConfig())}>
        <option value="">经典地图</option><option value={SCENARIO_1939.id}>架空世界政治地图 · 1939年1月1日</option>
        {config.scenario?.revision===1 && <option value="original">1939年1月1日 · 旧版</option>}
      </select>
      {config.scenario?.revision===2 && <Row label="图幅"><Segmented<AtlasSheet> value={config.atlasSheet??'world'}
        options={(Object.keys(ATLAS_SHEETS) as AtlasSheet[]).map(k=>({value:k,label:ATLAS_SHEETS[k].name}))} onChange={id=>update(c=>atlasSheet(c,id))}/></Row>}
    </Section>
    {atlas && <Section title="政区与标注">
      <label className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2">
        <Search size={14} className="text-zinc-400"/>
        <input className="min-w-0 flex-1 bg-transparent py-1.5 text-xs outline-none" aria-label="查找政区或地名" placeholder="查找政区、首府或岛群" value={search} onChange={e=>{setSearch(e.target.value);setChosenLabel('');}}/>
      </label>
      {unit ? <>
        <select aria-label="政区" className={field} value={unit.id} onChange={e=>{setChosen(e.target.value);setChosenLabel('');}}>
          {matches.map(u=><option key={u.id} value={u.id}>{u.name} · {u.id}</option>)}
        </select>
        <dl className="grid grid-cols-[4.1rem_1fr] gap-x-2 gap-y-1 text-[11px] text-zinc-300">
          {Object.entries({'身份':unit.status,'首府':unit.capital,'主权':unit.id==='ATA'?'未定':unit.coSovereigns?.map(describe).join('、')??describe(unit.sovereign),'实际管理':describe(unit.manager),
            '上级':unit.parent&&describe(unit.parent),'宗主':unit.suzerain&&describe(unit.suzerain),'主张方':unit.claims?.map(describe).join('、'),
            '中立保障':unit.guarantors?.map(describe).join('、')}).filter(([,v])=>v).map(([key,v])=><div className="contents" key={key}><dt className="text-zinc-500">{key}</dt><dd>{v}</dd></div>)}
        </dl>
        {unit.note&&<p className="text-[11px] leading-relaxed text-zinc-400">{unit.note}</p>}
        <details className="text-[11px] text-zinc-400">
          <summary className="cursor-pointer">岛群与边界依据</summary>
          <p className="mt-1 leading-relaxed">{atlas.islandGroups.filter(g=>g.unit===unit.id&&g.at).map(g=>g.name).join('、')}</p>
          <p className="mt-1 leading-relaxed">{unit.basis.join('、')||'由下级政区组成'}</p>
        </details>
        <Row label="政区颜色"><ColorField ariaLabel="政区颜色" value={territoryColor(unit.id,config,atlas.units)} onChange={value=>update(c=>({...c,territoryColors:{...c.territoryColors,[unit.id]:value}}))}/>
          <Button title="恢复政区配色" disabled={!config.territoryColors[unit.id]} onClick={()=>update(c=>{const colors={...c.territoryColors};delete colors[unit.id];return {...c,territoryColors:colors};})}><RotateCcw size={12}/></Button>
        </Row>
        {label&&<details className="text-xs text-zinc-300">
          <summary className="cursor-pointer py-1">标注与定位</summary>
          <div className="mt-2 space-y-2">
            <select aria-label="选择标注" className={field} value={label.id} onChange={e=>setChosenLabel(e.target.value)}>{labels.map(l=><option key={l.id} value={l.id}>{l.text}</option>)}</select>
            <input aria-label="标注文字" className={field} value={edit.text??label.text} onChange={e=>editLabel({text:e.target.value},true)} onBlur={commit}/>
            <Row label="水平偏移"><NumberField value={edit.dx??0} onChange={dx=>editLabel({dx},true)} onCommit={commit} className="w-20" suffix="px"/></Row>
            <Row label="垂直偏移"><NumberField value={edit.dy??0} onChange={dy=>editLabel({dy},true)} onCommit={commit} className="w-20" suffix="px"/></Row>
            <Row label="显示标注"><Toggle checked={!edit.hidden} onChange={v=>editLabel({hidden:!v})}/></Row>
            <div className="flex gap-2">
              <Button onClick={()=>update(c=>({...c,view:{projection:'mercator',lon:label.at[0],lat:Math.max(-84,Math.min(84,label.at[1])),angle:0,
                zoom:label.zoom>=100?3000:Math.min(400,Math.max(6,label.zoom*2.2))}}))}><Crosshair size={13}/> 定位</Button>
              <Button disabled={!config.labelEdits[label.id]} onClick={()=>update(c=>{const edits={...c.labelEdits};delete edits[label.id];return {...c,labelEdits:edits};})}><RotateCcw size={12}/> 恢复标注</Button>
            </div>
          </div>
        </details>}
      </>:<div className="text-xs text-zinc-400">未找到匹配政区</div>}
    </Section>}
  </>;
}
