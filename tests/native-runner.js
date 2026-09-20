import { armRemoteSave, runRemoteSave } from './remote-save.js';
import { runMatrix } from './midi-matrix.js';
/** Test-only companion module. Uses installed Foundry and the candidate module, never shipped in module.json. */
Hooks.once('ready', () => {
    new foundry.applications.api.DialogV2({
        window: { title: 'RollSight regression runner (test world only)' },
        content: '<p>Run synthetic dice through the installed RollSight module and real Foundry resolvers. No camera input. Dice settings are restored afterwards.</p>',
        buttons: [{action:'armRemote',label:'Arm next remote synthetic save (player)',callback:armRemoteSave},{action:'remote',label:'Test remote player save (GM)',callback:runRemoteSave},{action:'entries',label:'Run module entry points and workflows',callback:()=>runMatrix({extendedOnly:true})}, {action:'matrix',label:'Run simulated Midi-QOL matrix',callback:runMatrix}, { action: 'run', label: 'Run native regressions', callback: run },
            { action: 'transport', label: 'Wait for cloud d20 = 7', callback: transport }]
    }).render(true);
});

async function run() {
    const module = game.rollsight;
    const Roll = foundry.dice.Roll;
    const original = foundry.utils.deepClone(game.settings.get('core', 'diceConfiguration'));
    const originalMethod = CONFIG.Dice.fulfillment.methods.rollsight;
    const results = [`Foundry ${game.version}; ${game.system.id} ${game.system.version}`];
    const open = new Set();
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    const timeout = async promise => {
        let timer;
        try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out')), 8000); })]); }
        finally { clearTimeout(timer); }
    };
    const start = async formula => {
        const roll = new Roll(formula);
        let hook;
        const rendered = new Promise(resolve => { hook = Hooks.on('renderRollResolver', resolver => {
            if (resolver.roll === roll) { open.add(resolver); resolve(resolver); }
        }); });
        const evaluation = roll.evaluate({ allowInteractive: true });
        evaluation.catch(() => {});
        try { const resolver = await timeout(rendered); return { roll, resolver, evaluation }; }
        finally { Hooks.off('renderRollResolver', hook); }
    };
    const send = async (dice, id = crypto.randomUUID(), extra = {}) => module.handleRoll({ roll_id: id, timestamp: Date.now(), dice, ...extra });
    const done = async (item, expected) => {
        await timeout(item.evaluation);
        check(item.roll.total === expected, `total ${item.roll.total}, expected ${expected}`);
        await item.resolver.close(); open.delete(item.resolver);
        const data = await item.roll.toMessage({}, { create: false, messageMode: 'self' });
        check(data.whisper.includes(game.user.id), 'self message visibility lost');
    };
    const test = async (name, fn) => {
        try { await fn(); results.push(`PASS ${name}`); }
        catch (error) { results.push(`FAIL ${name}: ${error.message}`); }
        finally {
            for (const resolver of open) { module.session.remove(resolver); await resolver.close(); }
            open.clear();
        }
    };
    try {
        check(module && module.session.active, 'RollSight session is not active');
        await game.settings.set('core', 'diceConfiguration', { ...original, default: 'rollsight', d6: 'rollsight', d20: 'rollsight' });
        await test('native subtraction and self visibility', async () => {
            const item = await start('1d20 - 1'); await send([{ shape: 'd20', value: 7 }]); await done(item, 6);
        });
        await test('prompt uses native form content, not a header button', async () => {
            const item=await start('1d20');
            const prompt=item.resolver.element.querySelector('.rollsight-native-prompt');
            check(prompt && !prompt.closest('button'),'prompt incorrectly nested in form control');
            await send([{shape:'d20',value:8}]); await done(item,8);
        });
        await test('D&D5e ability, save and skill use original system pipeline', async () => {
            const actor=new CONFIG.Actor.documentClass({name:'RollSight transient fixture',type:'character',system:{abilities:{str:{value:8},dex:{value:8}}}});
            for(const [method,config] of [['rollAbilityCheck',{ability:'str'}],['rollSavingThrow',{ability:'str'}],['rollSkill',{skill:'acr'}]]) {
                let hook;
                const rendered=new Promise(resolve=>{hook=Hooks.on('renderRollResolver',r=>{open.add(r);resolve(r);});});
                const workflow=actor[method](config,{configure:false},{create:false}); workflow.catch(()=>{});
                let resolver;
                try {resolver=await timeout(rendered);} finally {Hooks.off('renderRollResolver',hook);}
                await send([{shape:'d20',value:7}]);
                const rolls=await timeout(workflow);
                check(rolls?.[0]?.total===6,method+' lost negative ability modifier');
                await resolver.close();open.delete(resolver);
            }
        });
        await test('Let Foundry roll the rest preserves supplied dice',async()=>{
            const item=await start('2d6');await send([{shape:'d6',value:5}]);
            const button=item.resolver.element.querySelector('button[type="submit"]');
            check(button.textContent.includes('Let Foundry roll the rest'),'Fallback button label is unclear');
            button.click();await timeout(item.evaluation);
            check(item.roll.dice[0].results[0].result===5,'Fallback replaced the physical result');
            check(item.roll.total>=6 && item.roll.total<=11,'Fallback did not fill the remaining die');
        });
        await test('native advantage modifiers', async () => {
            const item = await start('2d20kh1 + 4'); await send([{ shape: 'd20', value: 7 }, { shape: 'd20', value: 17 }]); await done(item, 21);
        });
        await test('native disadvantage modifiers', async () => {
            const item = await start('2d20kl1'); await send([{ faces: 20, results: [7,17] }]); await done(item, 7);
        });
        await test('mixed denominations in reverse delivery order', async () => {
            const item = await start('1d6 + 1d20'); await send([{ shape: 'd20', value: 17 }, { shape: 'd6', value: 5 }]); await done(item, 22);
        });
        await test('identical values accepted; duplicate ID rejected', async () => {
            const item = await start('2d6'); const id = crypto.randomUUID();
            await send([{ shape:'d6',value:5 }],id); await send([{ shape:'d6',value:5 }],id);
            const empty = [...item.resolver.element.querySelectorAll('input')].filter(i => i.value === '');
            check(empty.length === 1, 'redelivery filled another die');
            await send([{ shape:'d6',value:5 }]); await done(item,10);
        });
        await test('simultaneous same-formula prompts stay independent', async () => {
            const a = await start('1d20'); const b = await start('1d20');
            check(module.session.selected === null,'ambiguous prompt auto-selected');
            module.session.select(b.resolver); await send([{shape:'d20',value:19}]); await done(b,19);
            check(module.session.selected === null,'completion selected another prompt');
            module.session.select(a.resolver); await send([{shape:'d20',value:4}]); await done(a,4);
        });
        await test('invalid delivery does not partially fill', async () => {
            const item = await start('2d6'); await send([{shape:'d6',value:5},{shape:'d6',value:99}],crypto.randomUUID(),{roll_proof_url:'https://example.invalid/unused.gif'});
            check(item.roll.options.rollsightRequestId===undefined,'rejected proof tagged the roll');
            check(item.roll.options.rollsightReplayPayloads===undefined,'rejected proof leaked serialized metadata');
            check([...item.resolver.element.querySelectorAll('input')].every(i=>i.value===''),'invalid dice changed form');
            await send([{faces:6,results:[2,3]}]); await done(item,5);
        });
        await test('pause, stale request and resume', async () => {
            const item = await start('1d20'); module.session.pause(item.resolver);
            await send([{shape:'d20',value:20}]);
            check(item.resolver.element.querySelector('input').value==='','paused prompt accepted dice');
            module.session.select(item.resolver);
            await send([{shape:'d20',value:20}],crypto.randomUUID(),{request_id:'abandoned'});
            check(item.resolver.element.querySelector('input').value==='','stale request accepted');
            await send([{shape:'d20',value:3}]); await done(item,3);
        });
        await test('native reroll gets an additional physical result', async () => {
            const item = await start('1d6r1'); await send([{shape:'d6',value:1}]);
            await timeout(new Promise(resolve => { const timer=setInterval(()=>{
                if(item.resolver.element?.querySelector('.submit-result')) {clearInterval(timer);resolve();}
            },20);setTimeout(()=>clearInterval(timer),8000); }));
            await send([{shape:'d6',value:6}]); await done(item,6);
        });
        await game.settings.set('core', 'diceConfiguration', {...original,d6:'manual',d20:'manual'});
        await test('Manual mode fills and submits through native API', async () => {
            const item = await start('2d6'); await send([{faces:6,results:[4,4]}]); await done(item,8);
        });
        await test('physical serialized roll preserves tooltip dice and total', async () => {
            const roll = module.createFoundryRoll({dice:[{faces:6,results:[2,5]},{shape:'d20',value:17}]});
            check(roll.total===24,'physical total'); check(roll.dice.length===2,'dice term count');
            check(roll.dice[0].results.length===2,'grouped values lost');
            check((await roll.getTooltip()).includes('17'),'tooltip missing physical value');
        });
        await test('v14 blind and GM message visibility', async () => {
            const roll=module.createFoundryRoll({dice:[{shape:'d20',value:9}]});
            const blind=await roll.toMessage({},{create:false,messageMode:'blind'});
            check(blind.blind && blind.whisper.includes(game.user.id),'blind visibility lost');
            const gm=await roll.toMessage({},{create:false,messageMode:'gm'});
            check(!gm.blind && gm.whisper.includes(game.user.id),'GM visibility lost');
        });
    } catch(error) { results.push(`FAIL setup: ${error.message}`); }
    finally {
        for(const resolver of open) await resolver.close();
        await game.settings.set('core','diceConfiguration',original);
        CONFIG.Dice.fulfillment.methods.rollsight=originalMethod;
        results.push('Original dice settings restored. Synthetic results only; cloud/camera not exercised by this suite.');
    }
    const pre=document.createElement('pre'); pre.style.whiteSpace='pre-wrap'; pre.textContent=results.join('\n');
    new foundry.applications.api.DialogV2({window:{title:'RollSight native test results'},position:{width:700},content:pre.outerHTML,buttons:[{action:'close',label:'Close'}]}).render(true);
}


async function transport() {
    const original=foundry.utils.deepClone(game.settings.get('core','diceConfiguration'));
    let result;
    try {
        await game.settings.set('core','diceConfiguration',{...original,d20:'rollsight'});
        const roll=new foundry.dice.Roll('1d20 - 1');
        await roll.evaluate({allowInteractive:true});
        result=`${roll.total===6?'PASS':'FAIL'} Python desktop cloud transport → native Foundry resolver: ${roll.formula} = ${roll.total} (expected 6). Synthetic d20; camera not tested.`;
    } catch(error) { result='FAIL cloud transport: '+error.message; }
    finally {await game.settings.set('core','diceConfiguration',original);}
    const pre=document.createElement('pre');pre.style.whiteSpace='pre-wrap';pre.textContent=result;
    new foundry.applications.api.DialogV2({window:{title:'RollSight cloud transport result'},content:pre.outerHTML,buttons:[{action:'close',label:'Close'}]}).render(true);
}
