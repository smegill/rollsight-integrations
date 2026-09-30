// NODE_PATH=<bundled node_modules> node foundry_module/tests/stream-replay.browser.mjs
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const root=new URL('../rollsight-integration/',import.meta.url);
const server=createServer(async(req,res)=>{
    try {
        res.setHeader('Content-Type',req.url==='/'?'text/html':'text/javascript');
        res.end(req.url==='/'?'<html><body></body></html>':await readFile(new URL('.'+req.url,root)));
    } catch { res.statusCode=404;res.end(); }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
try {
    const page=await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const result=await page.evaluate(async()=>{
        const hooks=new Map();
        window.Hooks={once:(name,fn)=>hooks.set(name,[fn]),on:(name,fn)=>hooks.set(name,[...(hooks.get(name)||[]),fn])};
        const fire=(name,...args)=>(hooks.get(name)||[]).forEach(fn=>fn(...args));
        window.game={view:'stream',settings:{get:(_ns,key)=>({autoExpandRollReplay:false,rollReplayRefreshEverySeconds:1,rollReplayRefreshMaxSeconds:1})[key]},i18n:{format:k=>k,localize:k=>k}};
        const {RollSightIntegration}=await import('/rollsight.js');
        RollSightIntegration.prototype.connect=()=>{throw new Error('Stream connected as sender');};
        RollSightIntegration.prototype._startAutoWorldLink=()=>{throw new Error('Stream linked world');};
        fire('init');
        const message={isContentVisible:true,flags:{'rollsight-integration':{rollReplayPayload:{roll_proof_url:'https://example.com/replay.gif'}}}};
        const card=document.createElement('article');card.innerHTML='<div class="message-content">17</div>';document.body.append(card);
        // Foundry renders stream chat before streamReady, without normal ready.
        fire('renderChatMessageHTML',message,card);
        const beforeReady=card.querySelectorAll('details').length;
        fire('streamReady');fire('ready');
        fire('renderChatMessage',message,[card]);fire('dnd5e.renderChatMessage',message,card);
        const count=card.querySelectorAll('details').length;
        const expanded=card.querySelector('details').open;
        const noSender=!game.rollsight;
        const hidden=document.createElement('article');hidden.innerHTML='<div class="message-content"></div>';
        fire('renderChatMessageHTML',{...message,isContentVisible:false},hidden);
        const hiddenCount=hidden.querySelectorAll('details').length;
        // Normal players retain their own auto-expansion setting.
        game.view='game';const normal=document.createElement('article');normal.innerHTML='<div class="message-content"></div>';
        fire('renderChatMessageHTML',message,normal);
        const playerCollapsed=!normal.querySelector('details').open;
        card.querySelector('.message-content').replaceChildren();
        fire('dnd5e.renderChatMessage',message,card);
        return {beforeReady,count,expanded,noSender,hiddenCount,playerCollapsed,restored:card.querySelectorAll('details').length};
    });
    assert.deepEqual(result,{beforeReady:1,count:1,expanded:true,noSender:true,hiddenCount:0,playerCollapsed:true,restored:1});
    console.log('PASS: stream initial render, no sender, visibility, deduplication, expansion, player preference and D&D replacement');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
