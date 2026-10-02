import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const root=new URL('../rollsight-integration/',import.meta.url);
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/'){
  const lang=['en','fr','ar','ur'].includes(url.searchParams.get('lang'))?url.searchParams.get('lang'):'en';
  const catalog=JSON.parse(await readFile(new URL(`lang/${lang}.json`,root)));
  res.setHeader('Content-Type','text/html');res.end(`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/styles/rollsight-roll-proof.css"><body><script>
  window.saved=[];window.values={obsTurnsEnabled:false,obsTurnsPaused:false,obsTurnsConfig:{operatorUserId:'stream',actors:{hero:'Player scene'},npcScene:'',endScene:''}};
  window.game={user:{isGM:true},users:{contents:[{id:'stream',name:'Stream user'}]},actors:{contents:[{id:'hero',name:'Very long hero name <img src=x onerror=alert(1)>'}]},modules:new Map([['obs-utils',{active:true,api:{isOBS:()=>false,getOBSWebsocketClient:()=>undefined}}]]),i18n:{lang:${JSON.stringify(lang)},format:(key,args={})=>Object.entries(args).reduce((s,[k,v])=>s.replaceAll('{'+k+'}',v),(${JSON.stringify(catalog)})[key]||key)},settings:{get:(_,k)=>values[k],set:async(_,k,v)=>{saved.push([k,v]);values[k]=v}}};
  </script><script type="module">import * as panel from '/obs-turns.js';window.panel=panel;panel.openObsTurnPanel();</script>`);
 }else{res.setHeader('Content-Type',url.pathname.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(new URL('.'+url.pathname,root)));}
 }catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
try{
 const page=await browser.newPage({viewport:{width:900,height:760}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const lang of ['en','fr','ar','ur']){
  await page.setViewportSize({width:lang==='en'?900:360,height:760});
  await page.goto(`http://127.0.0.1:${server.address().port}/?lang=${lang}`);
  await page.locator('dialog').waitFor();
  assert.equal(await page.locator('dialog').getAttribute('dir'),['ar','ur'].includes(lang)?'rtl':'ltr');
  assert.ok(await page.locator('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),lang+' overflow');
  assert.equal(await page.locator('dialog img').count(),0);
  assert.equal(await page.locator('.rollsight-obs-turn-row input').inputValue(),'Player scene');
  await page.locator('.rollsight-obs-turn-row input').fill('Player camera');
  await page.locator('dialog button').last().click();
  await page.waitForFunction(()=>saved.length>=3);
  assert.equal(await page.evaluate(()=>values.obsTurnsConfig.actors.hero),'Player camera');
  assert.equal(await page.evaluate(()=>saved[0][0]),'obsTurnsPaused');
  assert.equal(await page.evaluate(()=>saved[0][1]),true);
  await page.keyboard.press('Escape');await page.locator('dialog').waitFor({state:'detached'});
  await page.evaluate(()=>{game.user.isGM=false;panel.openObsTurnPanel();});
  assert.equal(await page.locator('dialog').count(),0);
 }
 assert.deepEqual(errors,[]);console.log('PASS: OBS mapping save, fail-closed pause order, GM guard, escaped actor names, English/French/Arabic/Urdu responsive dialog');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
