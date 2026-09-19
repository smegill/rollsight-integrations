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
        const root = html?.[0] ?? html ?? app.element;
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
        field.after(actions);
    };
    Hooks.on('renderSettingsConfig', mount);
})();
