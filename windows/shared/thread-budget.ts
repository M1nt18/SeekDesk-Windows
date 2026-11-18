import type {Comment} from './types';
export const AUTO_FLOOR_BUDGET=500,AUTO_CHARACTER_BUDGET=16_000_000;
export const threadCharacters=(comments:Comment[])=>comments.reduce((total,row)=>total+row.html.length+(row.signatureHtml?.length||row.signature?.length||0),0);
export function chooseThreadEvictions(entries:{id:string;comments:Comment[];busy:boolean;used:number}[],activeId:string|null,limits={floors:2000,characters:16_000_000}):string[]{
  let floors=entries.reduce((n,row)=>n+row.comments.length,0),characters=entries.reduce((n,row)=>n+threadCharacters(row.comments),0);const dropped:string[]=[];
  for(const row of entries.filter(row=>row.id!==activeId&&!row.busy).sort((a,b)=>a.used-b.used)){
    if(floors<=limits.floors&&characters<=limits.characters)break;dropped.push(row.id);floors-=row.comments.length;characters-=threadCharacters(row.comments);
  }return dropped;
}
