/** Plain script loads setting schemas before the ES module; DOM works in v12–14. */
(() => {
    const ns = 'rollsight-integration';
    const text = key => game.i18n.localize(`ROLLSIGHT.${key}`);
    Hooks.once('init', () => {
        const register = (key, type, value, scope, label, hint, config = true) => game.settings.register(ns, key, {
            name: `ROLLSIGHT.${label}`, ...(hint ? { hint: `ROLLSIGHT.${hint}` } : {}), scope, config, type, default: value,
            onChange: () => {
                if (["playerActive", "desktopBridgePoll", "cloudRoomKey", "cloudRoomApiBase", "replaceManualDialog"].includes(key)) game.rollsight?.scheduleReconnect();
            }
        });
        register('playerActive', Boolean, true, 'client', 'Active', 'ActiveHint');
        register('desktopBridgePoll', Boolean, false, 'client', 'Extension', 'ExtensionHint');
        register('cloudPlayerKey', String, '', 'client', 'PlayerCode', 'PlayerCodeHint');
        register('cloudRoomKey', String, '', 'world', 'LinkWorld', null, false);
        register('cloudRoomApiBase', String, '', 'world', 'LinkWorld', null, false);
        register('desktopBridgeUrl', String, 'http://127.0.0.1:8766', 'client', 'Extension', null, false);
        register('replaceManualDialog', Boolean, true, 'world', 'Manual', 'ManualHint');
        register('fallbackToChat', Boolean, true, 'world', 'Fallback', 'FallbackHint');
        // Preserve the persisted key, but automatic initiative assignment has been retired.
        register('applyRollsToInitiative', Boolean, false, 'world', 'Manual', null, false);
        register('autoExpandRollReplay', Boolean, true, 'client', 'AutoReplay', null);
        register('rollReplayRefreshEverySeconds', Number, 5, 'client', 'RetryInterval', null);
        register('rollReplayRefreshMaxSeconds', Number, 60, 'client', 'RetryTimeout', null);
        register('debugLogging', Boolean, false, 'client', 'Debug', null);
    });
    const mount = (app, html) => {
        const root = (html?.nodeType ? html : html?.[0]) ?? app.element;
        const field = root?.querySelector?.('input[name="rollsight-integration.cloudPlayerKey"]');
        if (!field || root.querySelector('.rollsight-code-actions')) return;
        field.readOnly = true;
        field.dir = 'ltr';
        field.autocomplete = 'off';
        field.spellcheck = false;
        const actions = root.ownerDocument.createElement('div');
        actions.className = 'rollsight-code-actions';
        actions.dir = ['ar', 'ur'].includes(game.i18n.lang) ? 'rtl' : 'ltr';
        const addButton = (label, action) => {
            const button = root.ownerDocument.createElement('button');
            button.type = 'button'; button.textContent = text(label);
            button.addEventListener('click', async () => {
                button.disabled = true;
                try { await action(); }
                catch (error) { console.error('RollSight | Settings action failed', error); ui.notifications.error(text('CodeError')); }
                finally { button.disabled = false; }
            });
            actions.append(button);
        };
        addButton('Copy', async () => {
            if (!field.value) return ui.notifications.warn(text('NotLinked'));
            try { await navigator.clipboard.writeText(field.value); ui.notifications.info(text('Copied')); }
            catch (_) { field.focus(); field.select(); ui.notifications.warn(text('CopyManually')); }
        });
        addButton('Refresh', async () => {
            await game.rollsight?.connect();
            field.value = game.settings.get(ns, 'cloudPlayerKey');
        });
        if (game.user.isGM) addButton('LinkWorld', async () => {
            await game.rollsight?._autoProvisionRollSightCloudRelay();
            await game.rollsight?.connect();
            field.value = game.settings.get(ns, 'cloudPlayerKey');
        });
        const setup = root.ownerDocument.createElement('p');
        setup.className = 'rollsight-dice-setup';
        setup.dir = actions.dir;
        setup.setAttribute('role', 'status');
        const updateSetup = () => {
            const RollClass = globalThis.foundry?.dice?.Roll ?? globalThis.Roll;
            const key = RollClass?.DICE_CONFIGURATION_SETTING ?? 'diceConfiguration';
            const config = game.settings.get('core', key) ?? {};
            const acceptManual = game.settings.get(ns, 'replaceManualDialog') && game.user.hasPermission('MANUAL_ROLLS');
            const ready = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'].every(die => {
                const method = config[die] || config.default || CONFIG.Dice.fulfillment.defaultMethod;
                return method === 'rollsight' || (method === 'manual' && acceptManual);
            });
            setup.textContent = text(ready ? 'DiceReady' : 'DiceSetup');
        };
        addButton('DiceConfigure', () => {
            const RollClass = globalThis.foundry?.dice?.Roll ?? globalThis.Roll;
            const key = RollClass?.DICE_CONFIGURATION_SETTING ?? 'diceConfiguration';
            const menu = game.settings.menus.get(`core.${key}`);
            if (menu?.type) new menu.type().render(true);
        });
        updateSetup();
        const hook = Hooks.on('closeDiceConfig', updateSetup);
        const closeHook = Hooks.on('closeSettingsConfig', closed => {
            if (closed !== app) return;
            Hooks.off('closeDiceConfig', hook);
            Hooks.off('closeSettingsConfig', closeHook);
        });
        field.after(actions, setup);
    };
    Hooks.on('renderSettingsConfig', mount);
})();
