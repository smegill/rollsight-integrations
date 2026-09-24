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
        // One connection flow is shared with the prominent sidebar shortcut.
        const actions = root.ownerDocument.createElement('div');
        actions.className = 'rollsight-code-actions';
        const button = root.ownerDocument.createElement('button');
        button.type = 'button'; button.textContent = text('ConnectTitle');
        button.addEventListener('click', () => game.rollsight?.openConnection());
        actions.append(button);
        field.hidden = true;
        field.after(actions);

    };
    Hooks.on('renderSettingsConfig', mount);
})();
