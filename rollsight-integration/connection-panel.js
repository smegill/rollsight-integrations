/** Small native dialog, independent of Foundry's v12/v14 application classes. */
const ns = 'rollsight-integration';
const text = key => game.i18n.localize(`ROLLSIGHT.${key}`);
let panel;
const rootOf = (app, html) => (html?.nodeType ? html : html?.[0]) ?? (app.element?.nodeType ? app.element : app.element?.[0]);

export function openConnectionPanel() {
    if (panel?.isConnected) { panel.querySelector('button')?.focus(); return; }
    const dialog = panel = document.createElement('dialog');
    dialog.className = 'rollsight-connection-panel';
    dialog.dir = ['ar','ur'].includes(game.i18n.lang) ? 'rtl' : 'ltr';
    dialog.setAttribute('aria-labelledby','rollsight-connect-title');
    const add = (tag, key, parent = dialog) => {
        const element = document.createElement(tag);
        if (key) element.textContent = text(key);
        parent.append(element); return element;
    };
    const header = add('header');
    add('h2','ConnectTitle',header).id = 'rollsight-connect-title';
    const close = add('button','Close',header); close.type='button'; close.onclick=()=>dialog.close();
    add('p','ConnectIntro');
    const status = add('p'); status.className='rollsight-connection-status'; status.setAttribute('role','status');
    const label = add('label','PlayerCode'); label.htmlFor='rollsight-connect-code';
    const field = add('input'); field.id='rollsight-connect-code'; field.readOnly=true; field.dir='ltr'; field.autocomplete='off'; field.spellcheck=false;
    const copy = add('button','Copy'); copy.type='button'; copy.className='rollsight-connect-primary';
    const hint = add('p','ConnectPaste');
    const actions = add('div'); actions.className='rollsight-connect-actions';
    const retry=add('button','Refresh',actions); retry.type='button';
    const link=add('button','LinkWorld',actions); link.type='button';
    add('hr');
    add('h3','ConnectDiceTitle');
    add('p','ConnectDiceHelp');
    const dice=add('button','DiceConfigure'); dice.type='button';
    let busy=false;
    const refresh = () => {
        const integration=game.rollsight;
        const extension=game.settings.get(ns,'desktopBridgePoll');
        const active=game.settings.get(ns,'playerActive');
        const linked=!!game.settings.get(ns,'cloudRoomKey');
        const code=active && !extension ? integration?.currentPlayerCode || '' : '';
        field.value=code;
        field.hidden=label.hidden=copy.hidden=hint.hidden=extension || !active || !linked;
        copy.disabled=busy || !code;
        const state=integration?.status || 'Disconnected';
        const key=!active?'ConnectStopped':extension?'ConnectExtension':!linked?'NotLinked':state==='Connected'?'ConnectReady':state==='Connecting'?'ConnectChecking':state==='Reconnecting'?'ConnectRetrying':state;
        status.textContent=text(key);
        retry.hidden=!active || extension || !linked || ['Connected','Connecting','AnotherTab'].includes(state);
        retry.disabled=busy || state==='Connecting';
        link.hidden=!game.user.isGM || linked || extension || !active;
        link.disabled=busy;
    };
    const run = async action => {
        busy=true; refresh();
        try { await action(); }
        catch (_) { ui.notifications.error(text('CodeError')); }
        finally { busy=false; refresh(); }
    };
    copy.onclick = () => run(async () => {
        // Re-read readiness so a disconnected or newly switched identity is never copied.
        refresh();
        if (!field.value) return;
        try { await navigator.clipboard.writeText(field.value); ui.notifications.info(text('Copied')); }
        catch (_) {
            field.focus(); field.select();
            if (document.execCommand('copy')) ui.notifications.info(text('Copied'));
            else ui.notifications.warn(text('CopyManually'));
        }
    });
    retry.onclick=()=>run(()=>game.rollsight.connect());
    link.onclick=()=>run(async()=>{ await game.rollsight._autoProvisionRollSightCloudRelay(); await game.rollsight.connect(); });
    dice.onclick=()=>{
        const RollClass=globalThis.foundry?.dice?.Roll ?? globalThis.Roll;
        const menu=game.settings.menus.get(`core.${RollClass?.DICE_CONFIGURATION_SETTING || 'diceConfiguration'}`);
        if (menu?.type) { dialog.close(); new menu.type().render(true); }
    };
    const hook=Hooks.on('rollsightConnectionChanged',refresh);
    dialog.addEventListener('close',()=>{ Hooks.off('rollsightConnectionChanged',hook); dialog.remove(); if(panel===dialog) panel=null; },{once:true});
    document.body.append(dialog); refresh(); dialog.showModal();
}

export function mountConnectionShortcut(app, html) {
    const root=rootOf(app,html);
    if(!root?.querySelector || root.querySelector('.rollsight-connect-shortcut')) return;
    const section=root.querySelector('section.settings, #settings-game');
    if(!section) return;
    const button=root.ownerDocument.createElement('button');
    button.type='button'; button.className='rollsight-connect-shortcut';
    button.textContent=text('ConnectTitle'); button.onclick=openConnectionPanel;
    const firstButton=section.querySelector('button');
    if(firstButton) firstButton.before(button); else section.append(button);
}
Hooks.on('renderSettings',mountConnectionShortcut);
