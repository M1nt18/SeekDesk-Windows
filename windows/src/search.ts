/** Matches upstream ForumSearch: normalized AND terms with one-edit Latin tolerance. */
export function normalizeSearch(value:string):string {
  return value.normalize('NFKC').normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('zh-CN');
}
export function searchTerms(query:string):string[] {
  return normalizeSearch(query).split(/[\s,，、]+/u).filter(Boolean).slice(0,12);
}
export function oneEditApart(left:string,right:string):boolean {
  if(Math.abs(left.length-right.length)>1)return false;
  if(left.length===right.length){
    let first=-1,second=-1;
    for(let index=0;index<left.length;index++)if(left[index]!==right[index]){if(first<0)first=index;else if(second<0)second=index;else return false;}
    return second<0||second===first+1&&left[first]===right[second]&&left[second]===right[first];
  }
  const shorter=left.length<right.length?left:right,longer=left.length<right.length?right:left;
  let mismatch=0;while(mismatch<shorter.length&&shorter[mismatch]===longer[mismatch])mismatch++;
  return shorter.slice(mismatch)===longer.slice(mismatch+1);
}
export function matchesSearch(query:string|string[],fields:string[]):boolean {
  const terms=typeof query==='string'?searchTerms(query):query.map(normalizeSearch).slice(0,12);
  if(!terms.length)return true;
  const normalized=fields.map(normalizeSearch);
  return terms.every(term=>normalized.some(field=>field.includes(term)||/^[a-z0-9]{4,24}$/.test(term)&&field.split(/[^a-z0-9]+/).some(word=>oneEditApart(term,word))));
}
