// Read-only upstream extension smoke. Deliberately separate from the offline test suite.
import {ExtensionsService} from '../electron/extensions';
import {parseRss,RSS_URL} from '../electron/forum';
async function main(){
  const service=new ExtensionsService();
  const checks=await Promise.allSettled([
    ...(['realtime','daily','weekly'] as const).map(async period=>{const result=await service.rankings(period);return {source:`ranking:${period}`,items:result.items.length,first:result.items[0]?.title};}),
    service.exchangeRates('USD').then(result=>({source:'exchange',provider:result.source,time:result.fetchedAt,USD_CNY:result.rates.CNY})),
    service.rulings(0,'cshaizhihao').then(result=>({source:'rulings',items:result.records.length,url:result.source})),
    fetch(RSS_URL,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(8000)}).then(async response=>{if(!response.ok)throw new Error(`RSS HTTP ${response.status}`);return {source:'rss',items:parseRss(await response.text()).length};}),
  ]);
  checks.forEach((result,index)=>console.log(JSON.stringify(result.status==='fulfilled'?result.value:{source:['ranking:realtime','ranking:daily','ranking:weekly','exchange','rulings','rss'][index],error:result.reason instanceof Error?result.reason.message:String(result.reason)})));
  service.dispose();
}
void main();
