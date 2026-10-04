import { randomConsumerId } from './browser-crypto.js';
const CHANNEL = 'module.rollsight-integration';
const TYPE = 'rollsight-obs-scenes-v1';
const pending = new Map();

/** Read-only native browser API, with a bound for unavailable/denied callbacks. */
export function nativeObsCall(studio, method, timeout = 2000) {
    return new Promise((resolve, reject) => {
        if (typeof studio?.[method] !== 'function') return reject(new Error('OBS API unavailable'));
        const timer = setTimeout(() => reject(new Error('OBS API timeout')), timeout);
        try { studio[method](value => { clearTimeout(timer); resolve(value); }); }
        catch (error) { clearTimeout(timer); reject(error); }
    });
}
export async function readObsScenes(api, studio = globalThis.window?.obsstudio) {
    const bounded = async promise => {
        let timer;
        try { return await Promise.race([promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('OBS query timeout')), 2500);
        })]); } finally { clearTimeout(timer); }
    };
    try {
        const client = await bounded(Promise.resolve(api?.getOBSWebsocketClient?.()));
        if (client?.call) {
            const result = await bounded(client.call('GetSceneList'));
            return { scenes: cleanScenes(result?.scenes?.map(item => item.sceneName)), canSwitch: true };
        }
    } catch (_) { /* Native OBS browser control needs no WebSocket credentials. */ }
    const level = await nativeObsCall(studio, 'getControlLevel');
    if (typeof level !== 'number' || level < 2) return { scenes: [], canSwitch: false };
    return { scenes: cleanScenes(await nativeObsCall(studio, 'getScenes')), canSwitch: level >= 4 };
}
function cleanScenes(value) {
    return Array.isArray(value) ? [...new Set(value.filter(s => typeof s === 'string' && s.length <= 512))].slice(0, 1000) : [];
}

/** Queries carry no credentials or commands. Replies are correlated to one GM panel request. */
export function registerObsSceneDiscovery(getGame = () => game, getApi = () => game.modules.get('obs-utils')?.api) {
    const g = getGame();
    const socket = g.socket;
    if (!socket?.on) return;
    let busy = false;
    const receive = async data => {
        if (data?.type !== TYPE || typeof data.id !== 'string') return;
        if (data.kind === 'reply') {
            const request = pending.get(data.id);
            if (!request || data.recipient !== g.user?.id || data.operator !== request.operator) return;
            request.finish({ scenes: cleanScenes(data.scenes), canSwitch: data.canSwitch === true, available: data.available === true });
            return;
        }
        if (data.kind !== 'query' || data.operator !== g.user?.id || g.view !== 'stream'
            || !g.users?.get(data.sender)?.isGM || busy) return;
        busy = true;
        let result = { scenes: [], canSwitch: false, available: false };
        try { result = { ...await readObsScenes(getApi()), available: true }; }
        catch (_) { /* Return a useful unavailable state without leaking connection details. */ }
        finally { busy = false; }
        socket.emit(CHANNEL, { type: TYPE, kind: 'reply', id: data.id,
            recipient: data.sender, operator: g.user.id, ...result });
    };
    socket.on(CHANNEL, receive);
    return () => socket.off(CHANNEL, receive);
}
export function requestObsScenes(operator, g = game, timeout = 10000) {
    if (!g.user?.isGM || !operator || !g.socket?.connected) return Promise.reject(new Error('OBS query unavailable'));
    return new Promise((resolve, reject) => {
        const id = randomConsumerId();
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('OBS source did not respond')); }, timeout);
        pending.set(id, { operator, finish: result => { clearTimeout(timer); pending.delete(id); resolve(result); } });
        try { g.socket.emit(CHANNEL, { type: TYPE, kind: 'query', id, operator, sender: g.user.id }); }
        catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
}
