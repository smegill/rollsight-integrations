/** Disposable-world integration suite. Synthetic values enter RollSight.handleRoll. */
export async function runMatrix({extendedOnly=false}={}) {
    if (!game.user.isGM) return ui.notifications.warn('Run this synthetic suite as Gamemaster.');
    const rs = game.rollsight, Roll = foundry.dice.Roll;
    const original = foundry.utils.deepClone(game.settings.get('core', 'diceConfiguration'));
    const replay = game.settings.get('rollsight-integration', 'autoExpandRollReplay');
    const originalTargets = [...game.user.targets].map(t => t.id);
    const actors = [], tokens = [], messages = [], combats = [], results = [];
    const assert = (value, detail) => { if (!value) throw new Error(detail); };
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const bound = async promise => {
        let timer;
        try { return await Promise.race([promise, new Promise((_,reject) => timer=setTimeout(()=>reject(new Error('Timed out after 20 seconds')),20000))]); }
        finally { clearTimeout(timer); }
    };
    const test = async (name, fn) => {
        console.warn("RollSight matrix start",name);
        try { const detail = await fn(); results.push(`PASS ${name}${detail ? ': '+detail : ''}`); }
        catch (error) { results.push(`FAIL ${name}: ${error.message}`); console.error('RollSight matrix',name,error); }
    };
    const drive = async (operation, {d20=15, face=4, proof=false}={}) => {
        let count=0, delivered=0, failure;
        const open=new Set(), busy=new WeakSet();
        const hook=Hooks.on('renderRollResolver', resolver => {
            if (busy.has(resolver)) return;
            busy.add(resolver);open.add(resolver);count++;
            setTimeout(async()=>{
                try {
                    assert(resolver.element.querySelector('.rollsight-native-prompt'),'RollSight prompt missing');
                    assert(resolver.element.querySelector('.rollsight-prompt-logo')?.getAttribute('src')?.endsWith('/assets/rollsight-logo.png'),'Eyeball logo missing');
                    rs.session.select(resolver);
                    const dice=[...resolver.element.querySelectorAll('label[data-method] > input:not(:disabled)')]
                        .filter(input=>input.value==='').map(input=>({shape:input.closest('label').dataset.denomination,
                            value:input.closest('label').dataset.denomination==='d20'?d20:face}));
                    delivered+=dice.length;
                    await rs.handleRoll({roll_id:crypto.randomUUID(),timestamp:Date.now(),dice,
                        ...(proof?{roll_proof_url:`https://example.invalid/rollsight-synthetic-${crypto.randomUUID()}.gif`,roll_proof_pending:true}:{})});
                } catch(error) {failure=error;}
                finally {busy.delete(resolver);}
            },30);
        });
        try {
            const value=await bound(Promise.resolve().then(operation));
            if(failure)throw failure;
            assert(count>0 && delivered>0,`No native physical-dice prompt was used (result=${value?.constructor?.name}, aborted=${value?.aborted})`);
            return {value,count,delivered};
        } finally {
            Hooks.off('renderRollResolver',hook);
            for(const resolver of open) if(resolver.rendered) await resolver.close();
        }
    };
    const rollResult = r => Array.isArray(r) ? r[0] : r;
    const messageHook=Hooks.on('createChatMessage', m => {if(m.author?.id===game.user.id)messages.push(m);});
    try {
        assert(rs?.session.active,'RollSight is inactive');
        const midiActive = game.modules.get('midi-qol')?.active;
        await game.settings.set('rollsight-integration','autoExpandRollReplay',false);
        await game.settings.set('core','diceConfiguration',Object.fromEntries(['default','d4','d6','d8','d10','d12','d20','d100'].map(k=>[k,'rollsight'])));
        console.warn('RollSight matrix creating actor');
        const actor=await Actor.create({name:'RollSight Synthetic Tester',type:'character',
            system:{abilities:Object.fromEntries(['str','dex','con','int','wis','cha'].map(k=>[k,{value:14}])),
                attributes:{hp:{value:0,max:30},spellcasting:'wis'}, tools:{thief:{value:1,ability:'dex'}}},
            items:[{name:'Synthetic Fighter',type:'class',system:{identifier:'fighter',levels:1,hd:{denomination:'d10',spent:0}}}]});
        actors.push(actor);console.warn("RollSight matrix actor ready");
        if (!extendedOnly) {
        for(const ability of ['str','dex','con','int','wis','cha']) {
            for(const method of ['rollAbilityCheck','rollSavingThrow']) await test(`${method} ${ability}`,async()=>{
                const {value}=await drive(()=>actor[method]({ability},{configure:false},{create:false}),{d20:7});
                assert(rollResult(value)?.total===9,`Expected 7 + 2 = 9; got ${rollResult(value)?.total}`);
            });
        }
        for(const skill of Object.keys(CONFIG.DND5E.skills)) await test(`skill ${skill}`,async()=>{
            const {value}=await drive(()=>actor.rollSkill({skill},{configure:false},{create:false}),{d20:7});
            assert(rollResult(value)?.total===9,`Expected 7 + 2 = 9; got ${rollResult(value)?.total}`);
        });
        await test('normal skill chat create carries native replay',async()=>{
            const before=messages.length;
            const {value}=await drive(()=>actor.rollSkill({skill:'prc'},{configure:false},{create:true}),{d20:7,proof:true});
            const roll=rollResult(value);
            assert(roll?.total===9,`Expected 7 + 2 = 9; got ${roll?.total}`);
            assert(roll?.options?.rollsightReplayPayloads?.length===1,'Resolver roll lacked replay metadata');
            const card=messages.slice(before).find(m=>m.rolls?.some(r=>r?.options?.rollsightRequestId===roll.options.rollsightRequestId));
            assert(card,'Normal skill chat card did not retain the native roll request ID');
            assert(card.flags['rollsight-integration']?.rollReplayPayloads?.[0]?.roll_proof_url===roll.options.rollsightReplayPayloads[0].roll_proof_url,
                'Normal skill chat card lost replay metadata');
        });
        await test('tool proficiency check',async()=>{
            const {value}=await drive(()=>actor.rollToolCheck({tool:'thief',ability:'dex'},{configure:false},{create:false}),{d20:7});
            assert(rollResult(value)?.total===11,`Expected 7 + 2 + 2 = 11; got ${rollResult(value)?.total}`);
        });
        await test('death save and success counter',async()=>{
            const before=actor.system.attributes.death.success;
            const {value}=await drive(()=>actor.rollDeathSave({},{configure:false},{create:false}),{d20:15});
            assert(rollResult(value)?.total===15,'Death save did not keep physical 15');
            assert(actor.system.attributes.death.success===before+1,'Death success counter not updated');
        });
        await test('concentration check',async()=>{
            const {value}=await drive(()=>actor.rollConcentration({target:10},{configure:false},{create:false}),{d20:7});
            assert(rollResult(value)?.total===9,`Expected concentration 9; got ${rollResult(value)?.total}`);
        });
        await test('hit die recovery',async()=>{
            const {value}=await drive(()=>actor.rollHitDie({denomination:'d10'},{configure:false},{create:false}),{face:4});
            assert(rollResult(value)?.total===6,`Expected 4 + 2 = 6; got ${rollResult(value)?.total}`);
            assert(actor.system.attributes.hp.value===6,'Healing not applied');
        });
        for(const [formula,expected,options] of [
            ['2d20kh1 + 2',17,{d20:15}],['2d20kl1 + 2',9,{d20:7}],
            ['1d4 + 1d6 + 1d8 + 1d10 + 1d12 + 1d20 + 1d100',39,{}],
            ['6d6',24,{}],['2d8 + 2',10,{}],['1d8 + 2',6,{}],['1d20 - 2',13,{}]
        ]) await test(`native ${formula}`,async()=>{
            const {value}=await drive(()=>new Roll(formula).evaluate(),options);
            assert(value.total===expected,`Expected ${expected}; got ${value.total}`);
        });
        await test('serialized initiative replay and merged-card update',async()=>{
            const {value:roll}=await drive(()=>new Roll('1d20 + 2').evaluate(),{proof:true});
            const data=await roll.toMessage({flavor:'Synthetic replay regression'},{create:false,messageMode:'self'});
            const msg=await ChatMessage.create(data);
            assert(msg.flags['rollsight-integration']?.rollReplayPayloads?.length===1,'Replay absent on serialized create');
            const card=await ChatMessage.create({content:'Synthetic existing Midi-style card',whisper:[game.user.id]});
            await card.update({rolls:[JSON.stringify(roll.toJSON())]});
            assert(card.flags['rollsight-integration']?.rollReplayPayloads?.length===1,'Replay absent on existing card update');
        });
        }
        // Use actual SRD items and Midi's public completion API; no direct workflow/RNG mutation.
        const pack=game.packs.get('dnd5e.items');
        assert(pack,'SRD item pack unavailable');
        const index=await pack.getIndex();
        const entry=index.find(e=>e.name==='Longsword');
        assert(entry,'SRD Longsword unavailable');
        const itemData=(await pack.getDocument(entry._id)).toObject();delete itemData._id;
        const [weapon]=await actor.createEmbeddedDocuments('Item',[itemData]);
        const attack=weapon.system.activities.find(a=>a.type==='attack');
        assert(attack,'Longsword attack activity unavailable');
        const target=await Actor.create({name:'RollSight Synthetic Target',type:'npc',system:{attributes:{hp:{value:200,max:200},ac:{calc:'flat',flat:5}},abilities:{dex:{value:10}}}});
        actors.push(target);
        const scene=canvas.scene;assert(scene,'Active scene required');
        for(const [a,x] of [[actor,600],[target,700]]) {
            const doc=await a.getTokenDocument({x,y:600,actorLink:true});
            const [token]=await scene.createEmbeddedDocuments('Token',[doc.toObject()]);tokens.push(token);
        }
        await actor.update({'system.attributes.hp.value':30});
        await test('combat initiative and replay',async()=>{
            const combat=await Combat.create({scene:scene.id,active:false});combats.push(combat);
            const [combatant]=await combat.createEmbeddedDocuments('Combatant',[{actorId:actor.id,tokenId:tokens[0].id,sceneId:scene.id}]);
            await drive(()=>combat.rollInitiative([combatant.id],{messageOptions:{rollMode:'selfroll'}}),{d20:15,proof:true});
            assert(combatant.initiative===17,`Expected initiative 17; got ${combatant.initiative}`);
            assert(messages.some(m=>m.flags['rollsight-integration']?.rollReplayPayloads?.length),'Initiative replay absent');
        });
        if(game.modules.get('dice-calculator')?.active) await test('Dice Tray roll entry point',async()=>{
            const before=messages.length;
            await drive(()=>CONFIG.DICETRAY.roll('/r 1d20 + 2'),{d20:7});
            assert(messages.slice(before).some(m=>m.rolls?.[0]?.total===9),'Dice Tray chat result differs from physical 7 + 2');
        });
        if(game.modules.get('combat-tracker-dock')?.active) await test('Carousel initiative button',async()=>{
            const combat=combats[0],combatant=combat.combatants.contents[0];
            await combatant.update({initiative:null});
            const portrait=new CONFIG.combatTrackerDock.CombatantPortrait(combatant);await portrait.ready;
            let hook;
            try {
                const completion=new Promise(resolve=>{hook=Hooks.on('updateCombatant',c=>{if(c.id===combatant.id && c.initiative!==null)resolve(c);});});
                await drive(()=>{portrait.element.querySelector('.roll-initiative').click();return completion;},{d20:7});
                assert(combatant.initiative===9,'Carousel initiative did not preserve physical die');
            } finally {Hooks.off('updateCombatant',hook);portrait.element.remove();}
        });
        if(game.modules.get('monks-tokenbar')?.active) for(const request of ['ability:str','save:dex','skill:prc']) await test(`Monks TokenBar ${request}`,async()=>{
            await drive(()=>game.MonksTokenBar.requestRoll([tokens[0].id],{request,silent:true,fastForward:true,rollMode:'roll'}),{d20:7});
        });
        if(game.modules.get('token-action-hud-dnd5e')?.active) await test('Token Action HUD skill entry point',async()=>{
            const {RollHandler}=await import('/modules/token-action-hud-dnd5e/scripts/token-action-hud-dnd5e.min.js');
            const handler=new RollHandler();
            // HUD handlers intentionally return void: wait for the system's post-roll hook.
            let hook;
            try {
                const completion=new Promise(resolve=>{hook=Hooks.on('dnd5e.rollSkill', (rolls,context)=>resolve(rolls));});
                const button=document.createElement('button');
                button.addEventListener('click',event=>handler.rollSkill(event,actor,'prc'));
                const {value}=await drive(()=>{button.dispatchEvent(new MouseEvent('click',{shiftKey:true,bubbles:true}));return completion;},{d20:7});
                assert(rollResult(value)?.total===9,'HUD did not preserve physical 7 + 2');
            } finally {Hooks.off('dnd5e.rollSkill',hook);}
        });
        if (midiActive) for(const [name,d20] of [['normal attack and damage',15],['critical attack and damage',20],['natural-one miss',1]]) await test(`Midi ${name}`,async()=>{
            await target.update({'system.attributes.hp.value':200});
            const {value:workflow,count}=await drive(()=>MidiQOL.completeActivityUse(attack.uuid,
                {midiOptions:{targetUuids:[tokens[1].uuid],checkGMstatus:true,workflowOptions:{autoRollAttack:true,autoRollDamage:'onHit',fastForwardAttack:true,fastForwardDamage:true}}},
                {configure:false},{create:true}),{d20,proof:true});
            assert(workflow && !workflow.aborted,'Workflow aborted or failed to complete');
            const card=game.messages.get(workflow.itemCardId);
            assert(card?.flags['rollsight-integration']?.rollReplayPayloads?.length >= (d20===1?1:2),'Attack/damage replays absent on Midi card');
            await delay(150);
            assert(workflow.attackRoll?.dice[0]?.results[0]?.result===d20,'Physical attack die lost');
            if(d20===1) assert(target.system.attributes.hp.value===200 && count===1,'Miss caused damage or extra prompt');
            else {
                assert(count>=2,'No separate physical damage prompt');
                const expected=d20===20?10:6;
                assert(workflow.damageTotal===expected,`Expected damage ${expected}; got ${workflow.damageTotal}`);
                assert(target.system.attributes.hp.value===200-expected,`HP ${target.system.attributes.hp.value}; expected ${200-expected}`);
            }
            return `prompts=${count}, HP=${target.system.attributes.hp.value}`;
        });
        if (!midiActive) {
            await test('D&D attack prompt without Midi',async()=>{
                const {value}=await drive(()=>attack.rollAttack({}, {configure:false},{create:false}),{d20:15});
                assert(rollResult(value)?.dice[0]?.results[0]?.result===15,'Physical attack value lost');
            });
            await test('D&D damage prompt without Midi',async()=>{
                const before=messages.length;
                const {value}=await drive(()=>attack.rollDamage({}, {configure:false},{create:true}),{proof:true});
                const roll=rollResult(value);
                assert(roll?.total===6,`Expected damage 6; got ${roll?.total}`);
                assert(roll?.options?.rollsightReplayPayloads?.length===1,'Resolver damage roll lacked replay metadata');
                const card=messages.slice(before).find(m=>m.rolls?.some(r=>r?.options?.rollsightRequestId===roll.options.rollsightRequestId));
                assert(card,'Normal damage chat card did not retain the native roll request ID');
                assert(card.flags['rollsight-integration']?.rollReplayPayloads?.[0]?.roll_proof_url===roll.options.rollsightReplayPayloads[0].roll_proof_url,
                    'Normal damage chat card lost replay metadata');
            });
        }
        const spells=game.packs.get('dnd5e.spells');
        const spellIndex=await spells.getIndex();
        for (const name of ['Sacred Flame','Cure Wounds']) await test(`${midiActive?'Midi':'D&D'} ${name}`,async()=>{
            const entry=spellIndex.find(e=>e.name===name);assert(entry,`${name} missing`);
            const data=(await spells.getDocument(entry._id)).toObject();delete data._id;
            data.system.method='atwill';data.system.prepared=1;
            const [spell]=await actor.createEmbeddedDocuments('Item',[data]);
            const activity=spell.system.activities.find(a=>['save','heal'].includes(a.type));assert(activity,'No save/heal activity');
            await target.update({'system.attributes.hp.value':100});
            if(midiActive) {
                const {value:workflow,count}=await drive(()=>MidiQOL.completeActivityUse(activity.uuid,
                    {midiOptions:{targetUuids:[tokens[1].uuid],workflowOptions:{autoRollDamage:'always',fastForwardDamage:true}}},
                    {configure:false},{create:true}),{d20:7});
                assert(workflow && !workflow.aborted,'Workflow did not complete');await delay(150);
                if(name==='Sacred Flame') {
                    assert(count>=2,'Damage and save did not both prompt');
                    assert(workflow.saves.size===0,'Physical save 7 should fail');
                    assert(target.system.attributes.hp.value<100,'Failed save did not apply damage');
                } else assert(target.system.attributes.hp.value>100,'Physical healing did not increase HP');
                return `prompts=${count}, HP=${target.system.attributes.hp.value}`;
            } else {
                const {value}=await drive(()=>activity.rollDamage({}, {configure:false},{create:false}));
                assert(rollResult(value)?.total>0,'Damage/healing did not evaluate');
            }
        });
    } catch(error) {results.push(`FAIL suite setup: ${error.message}`);console.error(error);}
    finally {
        Hooks.off('createChatMessage',messageHook);
        for(const combat of combats) await combat.delete().catch(()=>{});
        for(const token of tokens) await token.delete().catch(()=>{});
        for(const actor of actors) await actor.delete().catch(()=>{});
        for(const message of messages) await message.delete().catch(()=>{});
        canvas.tokens?.setTargets(originalTargets);
        await game.settings.set('core','diceConfiguration',original);
        await game.settings.set('rollsight-integration','autoExpandRollReplay',replay);
    }
    results.unshift(`Foundry ${game.version}; D&D ${game.system.version}; Midi-QOL ${game.modules.get('midi-qol')?.active ? game.modules.get('midi-qol').version : 'disabled'}`);
    results.splice(1,0,'Active: '+[...game.modules.values()].filter(m=>m.active).map(m=>`${m.id} ${m.version}`).join(', '));
    results.push('Synthetic dice only; temporary actors/tokens/chat cards removed; original client settings restored.');
    const pre=document.createElement('pre');pre.style.whiteSpace='pre-wrap';pre.textContent=results.join('\n');
    new foundry.applications.api.DialogV2({window:{title:'RollSight Midi-QOL test matrix'},position:{width:760},content:pre.outerHTML,buttons:[{action:'close',label:'Close'}]}).render(true);
}
