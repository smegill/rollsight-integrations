/** Explicitly armed, one-roll, local test client. Never included in the shipped module. */
export async function armRemoteSave() {
    if (game.user.isGM) return ui.notifications.warn('Arm this on the test player client.');
    const original=foundry.utils.deepClone(game.settings.get('core','diceConfiguration'));
    await game.settings.set('core','diceConfiguration',{default:'rollsight',d20:'rollsight'});
    let hook,timer;
    const cleanup=async()=>{Hooks.off('renderRollResolver',hook);clearTimeout(timer);await game.settings.set('core','diceConfiguration',original);};
    hook=Hooks.once('renderRollResolver',async resolver=>{
        try {
            await new Promise(resolve=>setTimeout(resolve,50));
            game.rollsight.session.select(resolver);
            await game.rollsight.handleRoll({roll_id:crypto.randomUUID(),timestamp:Date.now(),dice:[{shape:'d20',value:7}],
                roll_proof_url:'https://example.invalid/remote-save.gif',roll_proof_pending:true});
            ui.notifications.info('Synthetic remote save delivered: face 7.');
        } finally {await cleanup();}
    });
    timer=setTimeout(cleanup,90000);
    ui.notifications.info('Next physical-dice prompt armed with synthetic d20 = 7 for 90 seconds.');
}
export async function runRemoteSave() {
    if(!game.user.isGM)return;
    let actor,message;
    let report;
    try {
        const player=game.users.find(u=>u.active&&!u.isGM);
        if(!player)throw new Error('No active test player.');
        actor=await Actor.create({name:'RollSight Synthetic Remote Save',type:'character',ownership:{default:0,[player.id]:3},system:{abilities:{dex:{value:14}}}});
        let timer;
        let data;
        try {
            data=await Promise.race([MidiQOL.socket().executeAsUser('rollAbility',player.id,{
                saveDetails:{actorUuid:actor.uuid,rollType:'save',rollAbilities:['dex'],rollDC:12,isMagicSave:true,workflowOptions:{}},
                displayOptions:{fastForward:true,chatMessage:false,rollMode:'public',showTargetDC:true}
            }),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Remote save timed out')),25000);})]);
        } finally {clearTimeout(timer);}
        const raw=Array.isArray(data)?data[0]:data;
        const roll=raw instanceof foundry.dice.Roll?raw:foundry.dice.Roll.fromData(typeof raw==='string'?JSON.parse(raw):raw);
        if(roll.total!==9 || roll.dice[0].results[0].result!==7)throw new Error(`Expected remote physical 7 + 2 = 9; got ${roll.total}`);
        message=await roll.toMessage({flavor:'Synthetic remote Midi save',whisper:[game.user.id]});
        if(message.flags['rollsight-integration']?.rollReplayPayloads?.[0]?.roll_proof_url!=='https://example.invalid/remote-save.gif')throw new Error('Remote replay metadata did not reach GM chat card');
        report='PASS Midi socketlib save on active player client: physical face 7, total 9.\nPASS GM-created chat card preserves remote replay metadata.\nThis exercises the same rollAbility socket handler used by Midi standard saves; it does not exercise chat-request timeout fallback.';
    }catch(error){report=`FAIL remote save: ${error.message}`;console.error(error);}
    finally{await message?.delete();await actor?.delete();}
    const pre=document.createElement('pre');pre.textContent=report;
    new foundry.applications.api.DialogV2({window:{title:'Remote player save results'},content:pre.outerHTML,buttons:[{action:'close',label:'Close'}]}).render(true);
}
