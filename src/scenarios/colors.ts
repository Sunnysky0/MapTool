import type { MapConfig, PoliticalUnit } from '../types';

export function territoryColor(id:string, config:MapConfig, units:Record<string,PoliticalUnit>):string {
  const unit=units[id];
  if (config.territoryColors[id]) return config.territoryColors[id];
  const base=(color:string)=>config.atlasTheme==='paper'
    ? '#'+[1,3,5].map(i=>Math.round(parseInt(color.slice(i,i+2),16)*.49+246*.51).toString(16).padStart(2,'0')).join('')
    : color;
  let ancestor=unit.parent;
  while (ancestor) {
    const override=config.territoryColors[ancestor];
    if (override) {
      const inherited=base(units[ancestor].color);
      const channel=(c:string,i:number)=>parseInt(c.slice(i,i+2),16);
      return '#'+[1,3,5].map(i=>Math.min(255,Math.max(0,channel(override,i)+channel(base(unit.color),i)-channel(inherited,i))).toString(16).padStart(2,'0')).join('');
    }
    ancestor=units[ancestor].parent;
  }
  return base(unit.color);
}
