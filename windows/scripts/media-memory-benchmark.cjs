/* Real compiled media/Sharp pipeline with synthetic HTTPS bodies, no network. */
const {MediaService}=require('../dist-electron/electron/media');const sharp=require('sharp'),{randomBytes}=require('node:crypto'),path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
(async()=>{
  const raw=await sharp(randomBytes(960*1920*3),{raw:{width:960,height:1920,channels:3}}).png().toBuffer();let calls=0;
  const previous=globalThis.fetch;globalThis.fetch=async(url,options)=>{assert.match(String(url),/^https:\/\/93\.184\.215\.14\//);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'manual');calls++;await new Promise(resolve=>setTimeout(resolve,5));return new Response(raw,{headers:{'content-type':'image/png'}});};
  const media=new MediaService(path.resolve(__dirname,'../.test-data/media-benchmark'),()=>null,{encryption:{isEncryptionAvailable:()=>false},dialogs:{}});let peakRSS=process.memoryUsage().rss,maxActive=0;
  const monitor=setInterval(()=>{peakRSS=Math.max(peakRSS,process.memoryUsage().rss);maxActive=Math.max(maxActive,media.imageCache.stats().active);},10);const start=performance.now();
  try{
    const jobs=Array.from({length:24},(_,i)=>media.readerImage('https://93.184.215.14/image-'+i+'.png',1200).then(image=>{assert.equal(image.width,960);assert.equal(image.height,1920);}));for(let i=0;i<8;i++)jobs.push(media.readerImage('https://93.184.215.14/image-0.png',1200).then(()=>{}));await Promise.all(jobs);await new Promise(setImmediate);
    const cache=media.imageCache.stats();assert.equal(calls,24);assert.ok(cache.bytes<=32_000_000);assert.ok(maxActive<=2);
    const report={scope:'Synthetic random 960×1920 PNGs through the actual compiled main-service code and Sharp, Node RSS sampled every 10 ms; no renderer/network, not total desktop RAM.',images:24,duplicateRequests:8,networkCalls:calls,maxConcurrentDecodes:maxActive,elapsedMs:Math.round(performance.now()-start),peakRSSMB:Math.round(peakRSS/1024/1024),cache};
    await fs.mkdir(path.resolve(__dirname,'../verification'),{recursive:true});await fs.writeFile(path.resolve(__dirname,'../verification/media-memory-benchmark.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{clearInterval(monitor);globalThis.fetch=previous;}
})().catch(error=>{console.error(error);process.exitCode=1;});
