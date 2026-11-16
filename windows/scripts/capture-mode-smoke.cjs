'use strict';

// Exercise only this project's compiled main in a fresh capture profile. The
// foreign application's EXEs, launcher and scripts are never executed.
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const project=path.resolve(__dirname,'..');
const output=path.join(project,'verification','capture-mode');
const task=path.join(project,'.test-data',`capture-mode-${Date.now()}-${process.pid}`);
const sentinel=path.join(task,'sentinel-profile');
const report={scope:'Actual compiled Electron capture CLI; fixture GET network; unique temporary capture userData; no foreign executable, installed user profile, registry or forum write.',checks:[]};
const check=name=>{report.checks.push(name);console.log('PASS',name);};
const createdProfiles=[];

function captureEntry(fixture){
  const {app,session,net}=require('electron');const io=require('node:fs');
  globalThis.fetch=(input,options)=>net.fetch(input,options);
  const state={writes:0,userDataDirectory:'',requests:0};
  const save=()=>io.writeFileSync(fixture.probe,JSON.stringify(state));
  app.once('ready',()=>{
    state.userDataDirectory=app.getPath('userData');save();
    const html='<!doctype html><meta charset="utf-8"><title>Capture public fixture</title><script>window.__config__={user:null};</script><div id="nsk-head"></div><div id="nsk-body-left"><ul class="post-list"><li class="post-list-item"><div class="post-title"><a href="/post-910001-1">PUBLIC_CAPTURE_FIXTURE</a></div><div class="info-author"><a href="/space/77">Public capture author</a></div><a class="post-category" href="/categories/tech">技术</a></li></ul></div>';
    const rss='<?xml version="1.0"?><rss><channel><item><title>PUBLIC_CAPTURE_FIXTURE</title><link>https://www.nodeseek.com/post-910001-1</link><author>Public capture author</author><description>Public fixture</description></item></channel></rss>';
    const route=request=>{
      state.requests++;
      if(!['GET','HEAD'].includes(request.method)){state.writes++;save();return new Response('No writes in capture QA',{status:405});}
      const url=new URL(request.url);
      if(url.hostname==='api.bimg.eu.org'&&/^\/(hot|daily|weekly)\.json$/.test(url.pathname))return new Response(JSON.stringify({posts:[{post:{id:910001,title:'PUBLIC_RANKING_FIXTURE',author:'Public capture author',category:'tech'},score:1}]}),{headers:{'content-type':'application/json'}});
      if(url.hostname==='rss.nodeseek.com')return new Response(rss,{headers:{'content-type':'application/rss+xml'}});
      if(['www.nodeseek.com','nodeseek.com'].includes(url.hostname))return new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}});
      return new Response('No remote network in capture QA',{status:404});
    };
    for(const partition of [undefined,'persist:nodeseek','public-rss','persist:calculator']){
      const current=partition?session.fromPartition(partition):session.defaultSession;
      current.protocol.handle('https',route);current.protocol.handle('http',route);
    }
  });
  require(fixture.main);
}
async function launch(entry,args){
  const env={...process.env,SEEKDESK_TEST:'1',SEEKDESK_USER_DATA:sentinel,SEEKDESK_DEV_URL:'http://not-a-valid-dev-host.invalid'};delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve,reject)=>{
    const child=spawn(require('electron'),[entry,'--host-resolver-rules=MAP * ~NOTFOUND',...args],{cwd:project,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',data=>{stdout+=data;});child.stderr.on('data',data=>{stderr+=data;});
    const timer=setTimeout(()=>{child.kill();reject(Error('Owned capture test process did not exit'));},45000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
  });
}
async function checkPng(file){
  const data=await fs.readFile(file);assert.ok(data.length>10000,'Capture should contain a rendered application rather than an empty frame');
  assert.deepEqual([...data.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  const size={width:data.readUInt32BE(16),height:data.readUInt32BE(20)};assert.ok(size.width>=960&&size.height>=680);return {bytes:data.length,...size,sha256:crypto.createHash('sha256').update(data).digest('hex')};
}
async function removeOwnedCapture(directory){
  const actual=await fs.realpath(directory),base=await fs.realpath(os.tmpdir());
  assert.ok(path.isAbsolute(actual)&&path.dirname(actual)===base&&path.basename(actual).startsWith('seekdesk-capture-'));
  assert.notEqual(actual,path.resolve(sentinel));
  await fs.rm(actual,{recursive:true,force:true});
}
(async()=>{
  await fs.mkdir(sentinel,{recursive:true});await fs.mkdir(output,{recursive:true});
  const marker=JSON.stringify({sentinel:'SYNTHETIC_SENTINEL_MUST_NOT_BE_USED'});await fs.writeFile(path.join(sentinel,'preferences.json'),marker);
  const entry=path.join(task,'entry.cjs'),probe=path.join(task,'probe.json');
  await fs.writeFile(entry,`(${captureEntry.toString()})(${JSON.stringify({main:path.join(project,'dist-electron/electron/main.js'),probe})});\n`);
  const png=path.join(output,`capture-${Date.now()}-${process.pid}.png`);
  const first=await launch(entry,['--screenshot',png]);assert.equal(first.code,0,first.stderr);
  const firstProbe=JSON.parse(await fs.readFile(probe,'utf8'));createdProfiles.push(firstProbe.userDataDirectory);
  assert.notEqual(path.resolve(firstProbe.userDataDirectory),path.resolve(sentinel));assert.ok(path.basename(firstProbe.userDataDirectory).startsWith('seekdesk-capture-'));assert.equal(firstProbe.writes,0);
  report.first=await checkPng(png);assert.equal(await fs.readFile(path.join(sentinel,'preferences.json'),'utf8'),marker);
  check('The actual CLI captures a rendered PNG and exits using its own fresh profile instead of the supplied test sentinel');
  const repeat=await launch(entry,['--screenshot',png]);assert.equal(repeat.code,1);assert.equal((await checkPng(png)).sha256,report.first.sha256);
  check('An existing screenshot destination is rejected without overwriting the image');
  const secondPath=path.join(output,`capture-equals-${Date.now()}-${process.pid}.png`);
  const second=await launch(entry,['--screenshot='+secondPath]);assert.equal(second.code,0,second.stderr);
  const secondProbe=JSON.parse(await fs.readFile(probe,'utf8'));createdProfiles.push(secondProbe.userDataDirectory);
  assert.notEqual(secondProbe.userDataDirectory,firstProbe.userDataDirectory);assert.equal(secondProbe.writes,0);
  report.second=await checkPng(secondPath);assert.equal(await fs.readFile(path.join(sentinel,'preferences.json'),'utf8'),marker);
  check('The equals-form CLI also exits successfully and independent capture calls never reuse a profile');
  report.status='pass';
})().catch(error=>{report.status='fail';report.failure=error.stack;console.error(error);process.exitCode=1;}).finally(async()=>{for(const directory of new Set(createdProfiles))await removeOwnedCapture(directory).catch(error=>{report.cleanupError=error.message;process.exitCode=1;});await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));});
