/**
 * ClientSettings registration only — no imports.
 * Loaded before rollsight.js so Configure Settings works even if the main module script fails to import.
 */
const RS_NS = "rollsight-integration";

let _rsSchemasDone = false;
let _rsSchemasInFlight = false;

function registerRollSightSettingSchemas() {
    if (_rsSchemasDone) return true;
    if (_rsSchemasInFlight) return false;
    _rsSchemasInFlight = true;
    try {
        const game = globalThis.game ?? (typeof foundry !== "undefined" && foundry.game ? foundry.game : null);
        if (!game?.settings || typeof game.settings.register !== "function") {
            return false;
        }

        game.settings.register(RS_NS, "playerActive", {
            name: "Use RollSight on this browser",
            hint: "Off: this tab will not poll the cloud or desktop bridge or apply RollSight rolls. On: normal operation. (The VTT Bridge browser extension is separate.)",
            scope: "client",
            config: true,
            type: Boolean,
            default: true
        });
        game.settings.register(RS_NS, "desktopBridgePoll", {
            name: "Poll RollSight desktop bridge (local)",
            hint: "Use when Foundry runs in the desktop app on the same PC as RollSight. Polls the HTTP bridge (default port 8766). If enabled, this wins over cloud polling. Do not turn on together with the VTT Bridge extension on the same machine (same queue).",
            scope: "client",
            config: true,
            type: Boolean,
            default: false
        });
        game.settings.register(RS_NS, "desktopBridgeUrl", {
            name: "Desktop bridge URL",
            hint: "Default http://127.0.0.1:8766. On Windows prefer 127.0.0.1 over localhost. Only used when Poll RollSight desktop bridge is on.",
            scope: "client",
            config: true,
            type: String,
            default: "http://127.0.0.1:8766"
        });

        game.settings.register(RS_NS, "cloudPlayerKey", {
            name: "RollSight app — your player code",
            hint: "8 characters — paste into the RollSight app on this PC (GM and players each get their own). Use Copy or Refresh if empty.",
            scope: "client",
            config: true,
            type: String,
            default: ""
        });

        // Internal: 8-char table code or legacy rs_* key — never shown in Configure Settings.
        game.settings.register(RS_NS, "cloudRoomKey", {
            name: "Cloud table link (internal)",
            hint: "Managed automatically. Not shown in the UI.",
            scope: "world",
            config: false,
            type: String,
            default: ""
        });

        game.settings.register(RS_NS, "cloudRoomApiBase", {
            name: "Cloud API base URL (advanced)",
            hint: "Leave empty to use rollsight.com. Only for self-hosted or development.",
            scope: "world",
            config: true,
            type: String,
            default: ""
        });

        game.settings.register(RS_NS, "replaceManualDialog", {
            name: "Replace manual dice dialog",
            hint: "When Foundry would show manual dice entry (skills, saves, many checks), show RollSight flow instead. Set Dice Configuration to Manual for dice you want from RollSight.",
            scope: "world",
            config: true,
            type: Boolean,
            default: true
        });
        game.settings.register(RS_NS, "fallbackToChat", {
            name: "Send to chat when no roll is waiting",
            hint: "If nothing is waiting in RollResolver, post the RollSight result to chat. Off: only fulfill in-context rolls.",
            scope: "world",
            config: true,
            type: Boolean,
            default: true
        });
        game.settings.register(RS_NS, "applyRollsToInitiative", {
            name: "Apply d20 to pending initiative",
            hint: "If combat is active and you have no initiative yet, a single d20 from RollSight can apply as your initiative without rolling in Foundry.",
            scope: "world",
            config: true,
            type: Boolean,
            default: true
        });

        game.settings.register(RS_NS, "autoExpandRollReplay", {
            name: "Auto-expand roll replay in chat",
            hint: "Open the RollSight Replay block when a message includes replay media.",
            scope: "client",
            config: true,
            type: Boolean,
            default: false
        });
        game.settings.register(RS_NS, "rollReplayRefreshEverySeconds", {
            name: "Replay retry interval (sec)",
            hint: "While a replay section is open, how often to retry loading the media if it is not ready yet.",
            scope: "client",
            config: true,
            type: Number,
            default: 3
        });
        game.settings.register(RS_NS, "rollReplayRefreshMaxSeconds", {
            name: "Replay retry timeout (sec)",
            hint: "Stop retrying replay loading after this many seconds.",
            scope: "client",
            config: true,
            type: Number,
            default: 20
        });

        game.settings.register(RS_NS, "debugLogging", {
            name: "Debug logging (console)",
            hint: "Verbose logs in the browser console (F12) for troubleshooting.",
            scope: "client",
            config: true,
            type: Boolean,
            default: false
        });

        console.info("RollSight Real Dice Reader | Settings schemas registered (rollsight-settings.js)");
        _rsSchemasDone = true;
        return true;
    } catch (err) {
        console.error("RollSight Real Dice Reader | rollsight-settings.js register failed:", err);
        return false;
    } finally {
        _rsSchemasInFlight = false;
    }
}

function tryRegisterRollSightSchemas() {
    if (_rsSchemasDone) return;
    registerRollSightSettingSchemas();
}

const HooksRef = (typeof foundry !== "undefined" && foundry.Hooks) ? foundry.Hooks : globalThis.Hooks;
const _rsRetryDelays = [0, 50, 150, 400, 1000, 2500];
if (HooksRef) {
    HooksRef.once("init", tryRegisterRollSightSchemas);
    HooksRef.once("setup", tryRegisterRollSightSchemas);
}
_rsRetryDelays.forEach((ms) => setTimeout(tryRegisterRollSightSchemas, ms));
