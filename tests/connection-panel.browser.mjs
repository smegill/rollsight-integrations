// Optional UI regression: NODE_PATH=<directory>/node_modules node this-file.mjs
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const moduleRoot=new URL('../rollsight-integration/',import.meta.url);
const english=JSON.parse(await readFile(new URL('lang/en.json',moduleRoot)));
const html=`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/styles/rollsight-roll-proof.css"></head><body style="background:#17191f;color:white;font-family:Arial"><aside id="settings"><section class="settings"><h4>Settings and Configuration</h4><button>Game Settings</button></section></aside><script>
const handlers=new Map(); window.Hooks={on:(key,fn)=>{if(!handlers.has(key))handlers.set(key,new Set());handlers.get(key).add(fn);return fn},off:(key,fn)=>handlers.get(key)?.delete(fn),callAll:(key,...args)=>handlers.get(key)?.forEach(fn=>fn(...args))};
window.messages=[]; window.ui={notifications:{info:m=>messages.push(m),warn:m=>messages.push(m),error:m=>messages.push(m)}};
window.values={playerActive:true,desktopBridgePoll:false,cloudRoomKey:'TESTROOM',cloudPlayerKey:'STALEKEY'};
window.game={i18n:{lang:'en',localize:key: null}};
</script></body></html>`.replace("localize:key: null",`localize:key=>(${JSON.stringify(english)})[key]||key`)
.replace('</script>',`game.user={isGM:false}; game.settings={get:(_ns,key)=>values[key],menus:new Map([['core.diceConfiguration',{type:class{render(){window.diceOpened=true}}}]])};
game.rollsight={status:'Connected',currentPlayerCode:'TESTCODE',connect:async()=>{game.rollsight.currentPlayerCode='FRESHKEY';game.rollsight.status='Connected';Hooks.callAll('rollsightConnectionChanged')},_autoProvisionRollSightCloudRelay:async()=>{values.cloudRoomKey='LINKED'}};
</script><script type="module">import * as panel from '/connection-panel.js';window.panel=panel;Hooks.callAll('renderSettings',{},document.querySelector('#settings'));</script>`);
const server=createServer(async(req,res)=>{try{res.setHeader('Content-Type',req.url==='/'?'text/html':req.url.endsWith('.css')?'text/css':'text/javascript');res.end(req.url==='/'?html:await readFile(new URL('.'+req.url,moduleRoot)));}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
try {
 const page=await browser.newPage({viewport:{width:900,height:760}}); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.getByRole('button',{name:'Connect RollSight'}).click();
 assert.equal(await page.locator('#rollsight-connect-code').inputValue(),'TESTCODE');
 assert.equal(await page.getByRole('button',{name:'Reconnect to RollSight',exact:true}).isVisible(),false);
 await page.getByRole('button',{name:'Copy code',exact:true}).click();
 await page.waitForFunction(()=>messages.length>0);
 await page.evaluate(()=>{game.rollsight.currentPlayerCode='';game.rollsight.status='CodeError';Hooks.callAll('rollsightConnectionChanged')});
 assert.equal(await page.locator('#rollsight-connect-code').inputValue(),'');
 assert.equal(await page.getByRole('button',{name:'Copy code',exact:true}).isEnabled(),false);
 await page.getByRole('button',{name:'Reconnect to RollSight'}).click();
 assert.equal(await page.locator('#rollsight-connect-code').inputValue(),'FRESHKEY');
 assert.equal(await page.getByRole('button',{name:'Set up this world'}).isVisible(),false);
 await page.screenshot({path:'/tmp/rollsight-connection-panel.png'});
 await page.getByRole('button',{name:'Configure dice',exact:true}).click();
 assert.equal(await page.evaluate(()=>diceOpened),true);
 await page.locator('dialog').waitFor({state:'detached'});
 // Legacy jQuery-style root, duplicate render, missing link, and role guard.
 await page.evaluate(()=>{panel.mountConnectionShortcut({},[document.querySelector('#settings')]);values.cloudRoomKey='';game.rollsight.currentPlayerCode='';});
 assert.equal(await page.getByRole('button',{name:'Connect RollSight'}).count(),1);
 await page.getByRole('button',{name:'Connect RollSight'}).click();
 assert.equal(await page.locator('#rollsight-connect-code').isVisible(),false);
 assert.equal(await page.getByRole('button',{name:'Set up this world'}).isVisible(),false);
 await page.evaluate(()=>{game.user.isGM=true;Hooks.callAll('rollsightConnectionChanged')});
 await page.getByRole('button',{name:'Set up this world'}).click();
 assert.equal(await page.locator('#rollsight-connect-code').inputValue(),'FRESHKEY');
 await page.keyboard.press('Escape'); await page.locator('dialog').waitFor({state:'detached'});
 await page.setViewportSize({width:360,height:640});
 await page.evaluate(()=>{game.i18n.lang='ar'});
 await page.getByRole('button',{name:'Connect RollSight'}).click();
 assert.equal(await page.locator('dialog').getAttribute('dir'),'rtl');
 assert.ok(await page.locator('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth));
 await page.screenshot({path:'/tmp/rollsight-connection-panel-rtl.png'});
 assert.deepEqual(errors,[]);
 console.log('PASS: sidebar, copy, stale code, reconnect, GM gating, dice settings, close/Escape, duplicate render, legacy root, narrow RTL');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
