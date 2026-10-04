import test from 'node:test';
import assert from 'node:assert/strict';
import { readObsScenes, nativeObsCall, registerObsSceneDiscovery, requestObsScenes } from '../rollsight-integration/obs-scene-discovery.js';

test('native scene discovery accepts Advanced and Full permissions and preserves exact names', async () => {
    for (const level of [4, 5]) {
        assert.deepEqual(await readObsScenes(null, {
            getControlLevel: fn => fn(level), getScenes: fn => fn(['IN GAME:Scott', ' Scene ', ' Scene ', '<img>']),
        }), { scenes: ['IN GAME:Scott', ' Scene ', '<img>'], canSwitch: true });
    }
    assert.deepEqual(await readObsScenes(null, {getControlLevel: fn => fn(1)}), {scenes: [], canSwitch: false});
});
test('WebSocket discovery requests only GetSceneList; failed connection falls back to native', async () => {
    const result = await readObsScenes({getOBSWebsocketClient: () => ({call: async method => {
        assert.equal(method, 'GetSceneList');return {scenes: [{sceneName: 'Scene'}]};
    }})});
    assert.deepEqual(result, {scenes:['Scene'],canSwitch:true});
    const fallback = await readObsScenes({getOBSWebsocketClient: () => {throw Error('offline');}}, {
        getControlLevel: fn => fn(2),getScenes: fn => fn(['Read only']),
    });
    assert.deepEqual(fallback,{scenes:['Read only'],canSwitch:false});
    await assert.rejects(nativeObsCall({getScenes: () => {}},'getScenes',5), /timeout/);
});
test('GM request reaches selected stream, correlates reply, and excludes normal game source', async () => {
    const handlers = new Set();let calls=0;
    const socket={connected:true,on:(_,fn)=>handlers.add(fn),off:(_,fn)=>handlers.delete(fn),
        emit:(_,data)=>{for(const fn of [...handlers])void fn(data);}};
    const gm={user:{id:'gm',isGM:true},socket,view:'game'};
    const stream={user:{id:'stream'},socket,view:'stream',users:new Map([['gm',gm.user]])};
    const api={getOBSWebsocketClient:()=>({call:async()=>{calls++;return {scenes:[{sceneName:'Exact:Name'}]};}})};
    const cleanup=[registerObsSceneDiscovery(()=>gm),registerObsSceneDiscovery(()=>stream,()=>api),
        registerObsSceneDiscovery(()=>({...stream,view:'game'}),()=>{throw Error('game source must not query');})];
    try {
        assert.deepEqual(await requestObsScenes('stream',gm),{scenes:['Exact:Name'],available:true,canSwitch:true});
        assert.equal(calls,1);
        await assert.rejects(requestObsScenes('missing',gm,5),/did not respond/);
        await assert.rejects(requestObsScenes('stream',{...gm,user:{id:'player',isGM:false}}),/unavailable/);
    } finally {cleanup.forEach(fn=>fn());}
});
