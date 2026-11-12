import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createQueryScript,validateQueryRequest} from '../electron/parity-forum';
import {formatPublicationDate} from '../shared/publication-date';

function fixture(fetcher:(url:string,options:any)=>Promise<any>){
  const page=new JSDOM('<div id="nsk-head"></div>',{url:'https://www.nodeseek.com/',runScripts:'outside-only'}),win=page.window as any;
  win.__config__={user:{member_id:42}};win.AbortSignal=AbortSignal;win.AbortController=AbortController;win.fetch=fetcher;
  return {page,win,query:(request:unknown)=>win.eval(createQueryScript(request,42))};
}
const postMarkup=(date:string)=>'<div class="nsk-post-wrapper"><div class="content-item" id="0"><div class="nsk-content-meta-info"><span class="date-created"><time datetime="'+date+'"></time></span></div></div></div>';
const reply={ok:true,status:200,headers:{get:()=>null}};

test('publication batch validates every ID, rejects oversized batches, and drops renderer extras',()=>{
  assert.deepEqual(validateQueryRequest({kind:'publication-dates',postIds:[12,12,13],url:'https://evil.test'}),{kind:'publication-dates',postIds:[12,13]});
  for(const postIds of [[1,2,3,4,5],['1'],[0],[-1],[Number.MAX_SAFE_INTEGER+1],null])assert.throws(()=>validateQueryRequest({kind:'publication-dates',postIds}));
});
test('publication dates read exact original floor time while markup stays inert and the request stays same-origin',async()=>{
  const calls:any[]=[];
  const f=fixture(async(url,options)=>{calls.push({url,options});return {...reply,url:'https://www.nodeseek.com'+url,text:async()=>'<script>window.__unsafe=1</script><img src="https://evil.test/tracker">'+postMarkup('2025-12-31T17:06:07Z')+'<div class="content-item" id="9"><time datetime="2026-11-11T00:00:00Z"></time></div>'};});
  try{
    const result=await f.query({kind:'publication-dates',postIds:[123,456]});
    assert.deepEqual(JSON.parse(JSON.stringify(result.publicationDates)),{123:'2025-12-31T17:06:07.000Z',456:'2025-12-31T17:06:07.000Z'});
    assert.equal(f.win.__unsafe,undefined);assert.equal(calls.length,2);assert.equal(calls[0].url,'/post-123-1');
    assert.equal(calls[0].options.credentials,'same-origin');assert.equal(calls[0].options.cache,'no-store');assert.equal(calls[0].options.redirect,'error');assert.ok(calls[0].options.signal);
  }finally{f.page.window.close();}
});
test('publication partial failures never fabricate a timestamp or accept a foreign or mismatched page',async()=>{
  const f=fixture(async(url)=>{
    if(url==='/post-1-1')return {...reply,url:'https://evil.test/post-1-1',text:async()=>postMarkup('2026-01-01')};
    if(url==='/post-2-1')return {...reply,url:'https://www.nodeseek.com/post-200-1',text:async()=>postMarkup('2026-01-01')};
    if(url==='/post-3-1')return {...reply,url:'https://www.nodeseek.com'+url,text:async()=>postMarkup('invalid')};
    return {...reply,url:'https://www.nodeseek.com'+url,text:async()=>postMarkup('2026-01-02T03:04:05Z')};
  });
  try{const result=await f.query({kind:'publication-dates',postIds:[1,2,3,4]});assert.deepEqual(JSON.parse(JSON.stringify(result.publicationDates)),{4:'2026-01-02T03:04:05.000Z'});}finally{f.page.window.close();}
});
test('publication reads reject results after account changes and do not treat Cloudflare pages as post dates',async()=>{
  let switched=false;
  const f=fixture(async(url)=>{if(switched)f.win.__config__.user.member_id=88;return {...reply,url:'https://www.nodeseek.com'+url,headers:{get:()=> 'challenge'},text:async()=>postMarkup('2026-01-01')};});
  try{assert.equal(Object.keys((await f.query({kind:'publication-dates',postIds:[1]})).publicationDates).length,0);switched=true;await assert.rejects(f.query({kind:'publication-dates',postIds:[1]}),/账号会话/);}finally{f.page.window.close();}
});
test('profile preserves zero rank, official registration text, role badges and zero-valued statistics',async()=>{
  const f=fixture(async()=>({...reply,json:async()=>({success:true,detail:{member_id:77,member_name:'成员',rank:0,created_at_str:'2024-03-02 11:22:33',roles:[{display_text:'管理员'},{display_text:'管理员'},{display_text:'赞助者'}],nPost:0,nComment:0,follows:0,fans:0,coin:0,followed:false}})}));
  try{const {profile}=await f.query({kind:'introduction',memberId:77});assert.equal(profile.rank,0);assert.equal(profile.joined,'2024-03-02 11:22:33');assert.equal(profile.topics,0);assert.equal(profile.followed,false);assert.deepEqual(Array.from(profile.roles),['管理员','赞助者']);}finally{f.page.window.close();}
});
test('publication formatter preserves date, seconds and year in local time and rejects unknown values',()=>{
  const value=formatPublicationDate('2024-01-02T03:04:05Z')!;
  const date=new Date(value.iso);assert.match(value.day,/^\d{4}-\d{2}-\d{2}$/);assert.equal(value.day.slice(0,4),String(date.getFullYear()));assert.equal(value.time.split(':')[2],'05');
  assert.equal(formatPublicationDate(''),null);assert.equal(formatPublicationDate('invalid'),null);assert.equal(formatPublicationDate(undefined),null);
});
test('a short final activity page has no phantom next page and root activities keep floor zero only in data',async()=>{
  const f=fixture(async()=>({...reply,json:async()=>({success:true,discussions:[{post_id:123,title:'主题'}]})}));
  try{const result=await f.query({kind:'space',memberId:77,section:'topics',page:3});assert.equal(result.nextPage,null);assert.equal(result.activity[0].floor,0);assert.equal(result.activity[0].url,'https://www.nodeseek.com/post-123-1');}finally{f.page.window.close();}
});
