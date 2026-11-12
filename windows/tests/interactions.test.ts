import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createActionScript,validateActionRequest} from '../electron/interactions';

type Call={url:string;options:Record<string,unknown>};
function fixture(fetcher?:(url:string,options:Record<string,unknown>)=>Promise<unknown>) {
  const page=new JSDOM('<div id="nsk-head"></div><div class="nsk-post-wrapper"><h1><a class="post-title-link">Fixture thread</a></h1></div>',{url:'https://www.nodeseek.com/post-123-1',runScripts:'outside-only'});
  const win=page.window as unknown as {__config__:any;AbortSignal:typeof AbortSignal;fetch:unknown};
  win.__config__={user:{member_id:42},postData:{postId:123,comments:[{floorIndex:0,commentId:9876,upvoteCount:4}]}};
  win.AbortSignal=AbortSignal;
  const calls:Call[]=[];
  win.fetch=async(url:string,options:Record<string,unknown>)=>{calls.push({url,options});return fetcher?fetcher(url,options):response({success:true,current:5,coin:20});};
  return {page,win,calls,run:(request:unknown)=>page.window.eval(createActionScript(request,42))};
}
function response(body:unknown,status=200,challenge=false) {
  return {ok:status>=200&&status<300,status,headers:{get:(name:string)=>challenge&&name==='cf-mitigated'?'challenge':null},json:async()=>body};
}
const reply={kind:'reply',url:'https://www.nodeseek.com/post-123-1',content:'A deliberate test reply'};
const reaction={kind:'react',url:'https://www.nodeseek.com/post-123-1',commentId:'0',reaction:'like'};

test('private-message mode reaches the official write unchanged and defaults to Markdown for old clients',async()=>{
  for(const markdown of [true,false,undefined]){
    const f=fixture();try{await f.run({kind:'message',memberId:8,content:'**content**',...(markdown===undefined?{}:{markdown})});assert.equal(JSON.parse(f.calls[0].options.body as string).markdown,markdown!==false);assert.equal(f.calls.length,1);}finally{f.page.window.close();}
  }
  assert.throws(()=>validateActionRequest({kind:'message',memberId:8,content:'text',markdown:'false'}),/格式/);
});

test('action inputs reject foreign targets, invalid members, unbounded content and malformed floor IDs',()=>{
  assert.throws(()=>createActionScript(reply,0));
  assert.throws(()=>validateActionRequest({...reply,url:'https://evil.test/post-123-1'}));
  assert.throws(()=>validateActionRequest({...reply,content:'  '}));
  assert.throws(()=>validateActionRequest({...reply,content:'x'.repeat(20_001)}));
  assert.throws(()=>validateActionRequest({kind:'follow',memberId:-2,follow:true}));
  assert.throws(()=>validateActionRequest({kind:'follow',memberId:42,follow:'yes'}));
  assert.throws(()=>validateActionRequest({...reaction,commentId:'0/../../delete'}));
  assert.throws(()=>validateActionRequest({...reaction,reaction:'remove'}));
});

test('reply matches upstream route, randomized CSRF header, explicit success and same-origin credentials',async()=>{
  const f=fixture();
  try {
    const result=await f.run(reply);
    assert.equal(result.message,'回复已发布');assert.equal(f.calls.length,1);
    const call=f.calls[0];assert.equal(call.url,'/api/content/new-comment');
    assert.deepEqual(JSON.parse(call.options.body as string),{postId:123,content:reply.content,mode:'new-comment'});
    assert.match((call.options.headers as Record<string,string>)['csrf-token'],/^[A-Za-z0-9]{16}$/);
    assert.equal(call.options.credentials,'same-origin');assert.equal(call.options.redirect,'error');
  } finally{f.page.window.close();}
});

test('accepted reply preserves a same-thread redirect destination and canonical floor anchor',async()=>{
  const f=fixture(async()=>response({success:true,redirect:'/post-123-3#comment-25'}));
  try {
    const result=await f.run(reply);
    assert.equal(result.message,'回复已发布');
    assert.deepEqual(JSON.parse(JSON.stringify(result.destination)),{url:'https://www.nodeseek.com/post-123-3#25',page:3,floor:'25'});
    assert.equal(f.calls.length,1);
  }finally{f.page.window.close();}
});

test('reply hash computes the genuine destination page using official comments-per-page',async()=>{
  for(const [size,hash,page] of [[undefined,'#25',3],[20,'#comment-25',2],[20,'25',2]] as const){
    const f=fixture(async()=>response({success:true,redirectHash:hash}));
    if(size!==undefined)f.win.__config__.commmentPerPage=size;
    try {
      const result=await f.run(reply);
      assert.deepEqual(JSON.parse(JSON.stringify(result.destination)),{url:`https://www.nodeseek.com/post-123-${page}#25`,page,floor:'25'});
      assert.equal(f.calls.length,1);
    }finally{f.page.window.close();}
  }
});

test('accepted replies never navigate foreign or different-thread redirects and keep valid hash fallback',async()=>{
  for(const redirect of ['https://evil.test/post-123-3#25','https://www.nodeseek.com/post-999-3#25','javascript:alert(1)']){
    const f=fixture(async()=>response({success:true,redirect,redirectHash:'#comment-25'}));
    try {
      const result=await f.run(reply);
      assert.equal(result.message,'回复已发布');
      assert.deepEqual(JSON.parse(JSON.stringify(result.destination)),{url:'https://www.nodeseek.com/post-123-3#25',page:3,floor:'25'});
      assert.equal(f.calls.length,1);
    }finally{f.page.window.close();}
  }
  const old=fixture(async()=>response({success:true}));
  try {const result=await old.run(reply);assert.equal(result.message,'回复已发布');assert.equal(result.destination,undefined);assert.equal(old.calls.length,1);}finally{old.page.window.close();}
});

test('account changes and wrong thread prevent all writes',async()=>{
  const f=fixture();
  try {
    f.win.__config__.user.member_id=77;
    await assert.rejects(f.run(reply),/账号会话已变化/);assert.equal(f.calls.length,0);
    f.win.__config__.user.member_id=42;
    await assert.rejects(f.run({...reply,url:'https://www.nodeseek.com/post-999-1'}),/帖子不一致/);
    assert.equal(f.calls.length,0);
  } finally{f.page.window.close();}
});

test('HTTP 200 error payload, challenge and unknown responses never report success or retry',async()=>{
  for(const payload of [response({success:false,message:'权限不足'}),response(null),response({},403,true),response({success:true},401)]) {
    const f=fixture(async()=>payload);
    try {await assert.rejects(f.run(reply));assert.equal(f.calls.length,1);}finally{f.page.window.close();}
  }
  const f=fixture(async()=>{throw new Error('transport disconnected');});
  try {await assert.rejects(f.run(reply),/可能已提交.*勿重复提交/);assert.equal(f.calls.length,1);}finally{f.page.window.close();}
});

test('concurrent duplicate submissions share a lock and issue only one write',async()=>{
  let resolveRequest!:(value:unknown)=>void;
  const f=fixture(()=>new Promise(resolve=>{resolveRequest=resolve;}));
  try {
    const first=f.run(reply);
    await assert.rejects(f.run(reply),/正在提交/);assert.equal(f.calls.length,1);
    resolveRequest(response({success:true}));await first;
  } finally{f.page.window.close();}
});

test('reaction floor resolves the genuine comment ID and plain like uses upvote, not paid chicken',async()=>{
  const f=fixture();
  try {
    const result=await f.run(reaction);
    assert.equal(result.message,'已点赞');assert.equal(result.count,5);
    assert.equal(f.calls[0].url,'/api/statistics/upvote');
    assert.deepEqual(JSON.parse(f.calls[0].options.body as string),{commentId:9876,action:'add'});
    await assert.rejects(f.run({...reaction,commentId:'123456'}),/真实评论编号/);
    assert.equal(f.calls.length,1);
  } finally{f.page.window.close();}
});

test('chicken checks quota before confirmation and rechecks free quota before any write',async()=>{
  let available=true;
  const f=fixture(async url=>url.includes('/progress/')?response({maxFreeLike:2,freeLikeUsed:available?1:2}):response({success:true,current:7}));
  try {
    const request={...reaction,reaction:'chicken'};
    const quote=await f.run(request);assert.equal(quote.confirmation,'free');assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.method,undefined);
    available=false;
    const changed=await f.run({...request,approval:'free'});assert.equal(changed.confirmation,'paid');assert.equal(f.calls.length,2);
    assert.ok(f.calls.every(call=>!call.options.method));
    await f.run({...request,approval:'paid'});assert.equal(f.calls.length,3);assert.equal(f.calls[2].url,'/api/statistics/like');
  } finally{f.page.window.close();}
});

test('dislike requires explicit paid confirmation and already performed reactions do not write',async()=>{
  const f=fixture();
  try {
    const first=await f.run({...reaction,reaction:'dislike'});assert.equal(first.confirmation,'paid');assert.equal(f.calls.length,0);
    assert.match(first.message,/消耗你 2 个鸡腿/);
    await f.run({...reaction,reaction:'dislike',approval:'paid'});assert.equal(f.calls[0].url,'/api/statistics/dislike');
    f.win.__config__.postData.comments[0].upvoted=true;
    const already=await f.run(reaction);assert.match(already.message,/已经/);assert.equal(f.calls.length,1);
  } finally{f.page.window.close();}
});

test('follow and private messages use confirmed official routes and reject self-targets',async()=>{
  const f=fixture();
  try {
    await f.run({kind:'follow',memberId:77,follow:true});
    await f.run({kind:'follow',memberId:77,follow:false});
    await f.run({kind:'message',memberId:77,content:'A deliberate private message'});
    assert.deepEqual(f.calls.map(call=>call.url),['/api/fans/add','/api/fans/del','/api/notification/message/send']);
    assert.deepEqual(JSON.parse(f.calls[0].options.body as string),{followed_member_id:77});
    assert.deepEqual(JSON.parse(f.calls[2].options.body as string),{receiverUid:77,content:'A deliberate private message',markdown:true});
    await assert.rejects(f.run({kind:'follow',memberId:42,follow:true}),/自己/);
    await assert.rejects(f.run({kind:'message',memberId:42,content:'self'}),/自己/);
    assert.equal(f.calls.length,3);
  } finally{f.page.window.close();}
});
