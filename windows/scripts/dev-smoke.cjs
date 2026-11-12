const {spawn,execFileSync}=require('node:child_process');
const {_electron}=require('playwright-core');
const path=require('node:path');
const fs=require('node:fs/promises');
const assert=require('node:assert/strict');
const {realpathSync}=require('node:fs');
const projectRoot=realpathSync(path.resolve(__dirname,'..'));
const devURL='http://127.0.0.1:5173';
const probeName=`.seekdesk-dev-hmr-${process.pid}.mjs`;
const probePath=path.join(projectRoot,'scripts',probeName);
let vite;
let app;
let page;
let output='';
const errors=[];
const consoleErrors=[];
(async()=>{
  execFileSync(process.execPath,[require.resolve('typescript/bin/tsc'),'-p','tsconfig.electron.json'],{cwd:projectRoot,stdio:'inherit'});
  await fs.mkdir(path.join(projectRoot,'verification'),{recursive:true});
  vite=spawn(process.execPath,[path.join(path.dirname(require.resolve('vite/package.json')),'bin/vite.js')],{cwd:projectRoot,stdio:'pipe'});
  const collect=value=>{output+=value.toString();};
  vite.stdout.on('data',collect);
  vite.stderr.on('data',value=>{collect(value);process.stderr.write(value);});
  let ready=false;
  for(let n=0;n<100;n++) {
    if(vite.exitCode!==null) throw new Error(`Vite exited before startup (${vite.exitCode}): ${output}`);
    try {
      const response=await fetch(devURL,{signal:AbortSignal.timeout(500)});
      if(response.ok && (await response.text()).includes('/src/main.tsx')) {ready=true;break;}
    } catch { /* Wait briefly for this test's server. */ }
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  assert.ok(ready,`Vite failed to start: ${output}`);
  const env={...process.env,SEEKDESK_DEV_URL:devURL,SEEKDESK_TEST:'1',SEEKDESK_USER_DATA:path.join(projectRoot,`.test-data/dev-smoke-${Date.now()}`)};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:require('electron'),args:[projectRoot],env,cwd:projectRoot});
  page=await app.firstWindow();
  page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  page.on('pageerror',error=>errors.push(error.message));
  await page.waitForSelector('.workspace',{timeout:30000});
  assert.equal((await page.evaluate(()=>window.seekdesk.bootstrap())).version,'0.1.0');
  assert.equal(page.url(),devURL+'/');
  assert.equal(await page.evaluate(()=>typeof window.$RefreshReg$==='function' && typeof window.$RefreshSig$==='function'),true,'The dev-only React Refresh inline preamble must pass CSP.');
  // Exercise Vite's actual file watcher and WebSocket update without editing product UI.
  const probeSource=marker=>`export const marker=${JSON.stringify(marker)}; window.__seekdeskHmrMarker=marker; if(import.meta.hot) import.meta.hot.accept(next=>{window.__seekdeskHmrMarker=next?.marker;});`;
  await fs.writeFile(probePath,probeSource('initial'));
  await page.evaluate(async url=>{await import(url);},`/scripts/${probeName}`);
  assert.equal(await page.evaluate(()=>window.__seekdeskHmrMarker),'initial');
  await fs.writeFile(probePath,probeSource('updated'));
  await page.waitForFunction(()=>window.__seekdeskHmrMarker==='updated',undefined,{timeout:10000});
  await page.getByTestId('settings-button').click();
  await page.getByTestId('settings-panel').waitFor();
  assert.deepEqual(errors,[]);
  assert.deepEqual(consoleErrors,[]);
  assert.ok(!output.includes('Error during dependency optimization'),output);
  await fs.writeFile(path.join(projectRoot,'verification/dev-smoke.json'),JSON.stringify({status:'pass',url:page.url(),physicalProjectRoot:projectRoot,ipcBootstrap:'pass',reactRender:'pass',settingsInteraction:'pass',reactRefreshCsp:'pass',hotModuleUpdate:'pass',errors,consoleErrors},null,2));
  console.log('PASS Vite + Electron development boot, IPC, settings interaction, React Refresh CSP, and live HMR');
})().catch(async error=>{
  console.error(error);
  if(page){console.log('BODY',await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:path.join(projectRoot,'verification/dev-failure.png')}).catch(()=>{});}
  process.exitCode=1;
}).finally(async()=>{if(app)await app.close();if(vite && vite.exitCode===null) vite.kill();await fs.unlink(probePath).catch(()=>{});});
