/**
 * ClientSettings registration + Configure Settings UI — no imports.
 * Listed under `scripts` (not `esmodules`) so v12 loads it before `init`; ES module entry can miss `Hooks.once("init")`.
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

        // Hidden legacy toggles (cloud path only in UI for now).
        game.settings.register(RS_NS, "playerActive", {
            name: "RollSight active (this browser)",
            hint: "Legacy internal flag.",
            scope: "client",
            config: false,
            type: Boolean,
            default: true
        });
        game.settings.register(RS_NS, "desktopBridgePoll", {
            name: "Poll desktop bridge",
            hint: "Legacy internal.",
            scope: "client",
            config: false,
            type: Boolean,
            default: false
        });
        game.settings.register(RS_NS, "desktopBridgeUrl", {
            name: "Desktop bridge URL",
            hint: "Legacy internal.",
            scope: "client",
            config: false,
            type: String,
            default: "http://127.0.0.1:8766"
        });

        game.settings.register(RS_NS, "cloudPlayerKey", {
            name: "RollSight app — your player code",
            hint: "Display only (assigned by RollSight). Copy into the RollSight app on this PC. If blank, use “Get my RollSight player code” below.",
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
            name: "Cloud API base URL (internal)",
            hint: "Leave empty for rollsight.com. Shown only via API override in code.",
            scope: "world",
            config: false,
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

// ——— Configure Game Settings UI (v12 + v13): lives here so it runs even if rollsight.js fails to load ———

const ROLLSIGHT_ROOM_API_DEFAULT = "https://www.rollsight.com/api";
const ROLLSIGHT_SHORT_CODE_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/i;
const ROLLSIGHT_PLAYER_FIELD_SEL =
    'input[name="rollsight-integration.cloudPlayerKey"],textarea[name="rollsight-integration.cloudPlayerKey"],' +
    'input[name="rollsight-integration_cloudPlayerKey"],textarea[name="rollsight-integration_cloudPlayerKey"],' +
    'input[name*="cloudPlayerKey"],textarea[name*="cloudPlayerKey"],' +
    'input[id*="cloudPlayerKey"],textarea[id*="cloudPlayerKey"]';

/** v12 may not fire renderSettingsConfig the same way as v13; gate renderApplication so we do not run on every window. */
function rsIsSettingsConfigApp(app) {
    if (!app) return false;
    if (app.constructor?.name === "SettingsConfig") return true;
    const id = app.options?.id ?? app.id;
    if (id === "settings-config" || id === "client-settings") return true;
    try {
        const SC = foundry?.applications?.settings?.SettingsConfig;
        if (SC && app instanceof SC) return true;
    } catch (_e) {
        /* ignore */
    }
    const cls = app.options?.classes;
    if (Array.isArray(cls) && cls.some((c) => String(c).toLowerCase().indexOf("settings-config") >= 0)) return true;
    return false;
}

function rsApiBase(game) {
    const raw = (game?.settings?.get(RS_NS, "cloudRoomApiBase") ?? "").toString().trim();
    return raw ? raw.replace(/\/$/, "") : ROLLSIGHT_ROOM_API_DEFAULT;
}

function rsNormShort(s) {
    return String(s).trim().toUpperCase();
}

function rsIsShort(s) {
    return ROLLSIGHT_SHORT_CODE_RE.test(rsNormShort(s));
}

function rsHasTableCloudRoomKey(game) {
    const ck = (game?.settings?.get(RS_NS, "cloudRoomKey") ?? "").toString().trim();
    return rsIsShort(ck) || (ck.startsWith("rs_") && ck.length >= 16 && !ck.startsWith("rs_u_"));
}

function rsGetFoundryUserId(game) {
    const u = game?.user;
    if (u) {
        const id = u.id ?? u._id;
        if (id != null && String(id).trim() !== "") return String(id).trim();
    }
    const uid = game?.userId;
    if (typeof uid === "string" && uid.trim() !== "") return uid.trim();
    return "";
}

function rsJqRoot(elOrJq) {
    if (!elOrJq) return $();
    return typeof elOrJq.jquery !== "undefined" ? elOrJq : $(elOrJq);
}

/**
 * Collect DOM roots where module settings might live (v12 sidebar vs v13 tabbed sheet).
 */
function rsEnumerateSettingsRoots(app, html) {
    const roots = [];
    const add = (x) => {
        const $x = rsJqRoot(x);
        if ($x.length) roots.push($x);
    };
    add(html);
    if (app?.element) add(app.element);
    add(document.getElementById("client-settings"));
    add(document.getElementById("settings-config"));
    add(document.querySelector("#game-settings"));
    add($('form[data-module-name="rollsight-integration"]'));
    add($('[data-package="rollsight-integration"]'));
    $(".window-app").each(function () {
        const $w = $(this);
        const title = ($w.find(".window-title").text() || $w.attr("aria-label") || "").toLowerCase();
        if (title.indexOf("setting") >= 0 || title.indexOf("configure") >= 0) add($w);
    });
    return roots;
}

function rsFindPlayerFieldInRoots(roots) {
    for (let i = 0; i < roots.length; i++) {
        const $inp = roots[i].find(ROLLSIGHT_PLAYER_FIELD_SEL).first();
        if ($inp.length) {
            let $sheet = $inp.closest(".window-app");
            if (!$sheet.length) $sheet = $inp.closest("#client-settings, #settings-config, #game-settings, .standard-form");
            if (!$sheet.length) $sheet = roots[i];
            return { $inp, $sheet };
        }
    }
    const $g = $(ROLLSIGHT_PLAYER_FIELD_SEL).first();
    if ($g.length) {
        let $sheet = $g.closest(".window-app");
        if (!$sheet.length) $sheet = $(document.body);
        return { $inp: $g, $sheet };
    }
    return { $inp: $(), $sheet: $() };
}

function rsPlayerSettingGroup($inp) {
    if (!$inp?.length) return $();
    let $g = $inp.closest(".form-group");
    if (!$g.length) $g = $inp.closest("fieldset, .module-setting, .setting-group, .flexrow, .form-fields");
    if (!$g.length) $g = $inp.parent();
    return $g;
}

async function rsProvisionPlayerCodeOnly(game) {
    if (!game?.settings || !game.user) return;
    const pk = (game.settings.get(RS_NS, "cloudPlayerKey") ?? "").toString().trim();
    if (pk) return;
    if (!rsHasTableCloudRoomKey(game)) return;
    const foundryUserId = rsGetFoundryUserId(game);
    if (!foundryUserId) return;
    const roomKey = (game.settings.get(RS_NS, "cloudRoomKey") ?? "").toString().trim();
    try {
        const base = rsApiBase(game);
        const body = { foundry_user_id: foundryUserId };
        if (rsIsShort(roomKey)) body.room_code = rsNormShort(roomKey);
        else body.room_key = roomKey;
        const res = await fetch(`${base}/rollsight-room/player-key`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!res.ok) return;
        const data = await res.json();
        const code = data.player_code || data.player_key;
        if (!code) return;
        await game.settings.set(RS_NS, "cloudPlayerKey", code);
    } catch (_e) {
        /* ignore */
    }
}

async function rsAutoProvisionCloudRelay(game) {
    if (game?.rollsight && typeof game.rollsight._autoProvisionRollSightCloudRelay === "function") {
        await game.rollsight._autoProvisionRollSightCloudRelay();
        return;
    }
    const ui = (typeof foundry !== "undefined" && foundry.ui) ? foundry.ui : globalThis.ui;
    if (!game?.settings || !game.user) return;
    let createdTable = false;
    if (game.user.isGM && !rsHasTableCloudRoomKey(game)) {
        try {
            const base = rsApiBase(game);
            const res = await fetch(`${base}/rollsight-room/create`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
            });
            if (res.ok) {
                const data = await res.json();
                const room_code = data.room_code || data.room_key;
                if (room_code) {
                    await game.settings.set(RS_NS, "cloudRoomKey", room_code);
                    createdTable = true;
                }
            }
        } catch (_e) {
            /* ignore */
        }
        if (!createdTable && game.user.isGM && !rsHasTableCloudRoomKey(game)) {
            ui?.notifications?.warn(
                "RollSight could not link this world automatically. Use “Link this world to RollSight cloud” in Module Settings (GM).",
                { permanent: false }
            );
        }
    }
    if (createdTable) {
        ui?.notifications?.info(
            "RollSight: this world is linked to the cloud. Use your personal player code in the RollSight app.",
            { permanent: false }
        );
    }
    await rsProvisionPlayerCodeOnly(game);
}

let _rsConfigureSettingsUiHooked = false;

function registerRollSightConfigureSettingsUiHook() {
    if (_rsConfigureSettingsUiHooked) return;
    const H = (typeof foundry !== "undefined" && foundry.Hooks) ? foundry.Hooks : globalThis.Hooks;
    if (!H?.on) return;
    _rsConfigureSettingsUiHooked = true;

    const rsScheduleSettingsUiMount = (app, html) => {
        const mount = () => {
            try {
                const game = globalThis.game ?? (typeof foundry !== "undefined" && foundry.game ? foundry.game : null);
                if (!game?.settings || !game.user) return;

                const roots = rsEnumerateSettingsRoots(app, html);
                const { $inp: $playerInp, $sheet } = rsFindPlayerFieldInRoots(roots);
                if (!$playerInp.length) return;

                const bindReadonlyCodeRow = ($inp, emptyWarn) => {
                    if (!$inp.length || $inp.data("rollsightReadonlyBound")) return;
                    $inp.data("rollsightReadonlyBound", true);
                    $inp
                        .attr("readonly", "readonly")
                        .attr("spellcheck", "false")
                        .attr("autocomplete", "off")
                        .addClass("rollsight-readonly-code");
                    const el = $inp[0];
                    if (el) {
                        el.readOnly = true;
                        if (el.tagName === "TEXTAREA") {
                            el.rows = 1;
                            el.style.resize = "none";
                        }
                    }
                    const blockMutate = (ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        return false;
                    };
                    $inp.on("paste cut drop dragover", blockMutate);
                    if (typeof InputEvent !== "undefined" && "onbeforeinput" in document.createElement("input")) {
                        $inp.on("beforeinput", (ev) => {
                            const t = ev.originalEvent?.inputType || "";
                            if (t.startsWith("insert") || t.startsWith("delete")) return blockMutate(ev);
                        });
                    }
                    const $row = $(
                        '<span class="rollsight-code-actions" style="display:inline-flex;align-items:center;gap:6px;margin-left:6px;vertical-align:middle;"></span>'
                    );
                    const $copy = $(
                        '<button type="button" class="rollsight-code-copy" title="Copy to clipboard"><i class="fas fa-copy"></i></button>'
                    );
                    const warn = emptyWarn || "Nothing to copy yet.";
                    $copy.on("click", async (ev) => {
                        ev.preventDefault();
                        const v = String($inp.val() ?? "").trim();
                        if (!v) {
                            (typeof foundry !== "undefined" && foundry.ui ? foundry.ui : globalThis.ui).notifications.warn(warn);
                            return;
                        }
                        try {
                            await navigator.clipboard.writeText(v);
                            (typeof foundry !== "undefined" && foundry.ui ? foundry.ui : globalThis.ui).notifications.info("Copied to clipboard.");
                        } catch (_e) {
                            (typeof foundry !== "undefined" && foundry.ui ? foundry.ui : globalThis.ui).notifications.error(
                                "Could not copy — select the field and copy manually (Ctrl+C)."
                            );
                        }
                    });
                    $row.append($copy);
                    $inp.after($row);
                };

                bindReadonlyCodeRow(
                    $playerInp,
                    "No player code yet — use “Get my RollSight player code” below or the sync button."
                );

                const $playerGroup = rsPlayerSettingGroup($playerInp);
                const ui = (typeof foundry !== "undefined" && foundry.ui) ? foundry.ui : globalThis.ui;

                const runPlayerCodeRequest = async () => {
                    const roomKey = (game.settings.get(RS_NS, "cloudRoomKey") ?? "").toString().trim();
                    const hasTable =
                        rsIsShort(roomKey) || (roomKey.startsWith("rs_") && roomKey.length >= 16 && !roomKey.startsWith("rs_u_"));
                    if (!hasTable) {
                        ui.notifications.error(
                            "This world is not linked to RollSight cloud yet — the GM should use “Link this world” in Module Settings, or reload after the world loads."
                        );
                        return false;
                    }
                    const fid = rsGetFoundryUserId(game);
                    if (!fid) {
                        ui.notifications.error("Could not read your Foundry user id — reload the page and try again.");
                        return false;
                    }
                    const base = rsApiBase(game);
                    const body = { foundry_user_id: fid };
                    if (rsIsShort(roomKey)) body.room_code = rsNormShort(roomKey);
                    else body.room_key = roomKey;
                    const res = await fetch(`${base}/rollsight-room/player-key`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(body),
                    });
                    if (!res.ok) {
                        const errText = await res.text().catch(() => "");
                        let errMsg = "";
                        try {
                            const j = JSON.parse(errText);
                            errMsg = j?.message || j?.error || "";
                        } catch (_e) {
                            errMsg = errText.slice(0, 200);
                        }
                        console.warn("RollSight | player-key HTTP", res.status, errMsg || errText.slice(0, 200));
                        ui.notifications.error(errMsg || "Could not assign player code.");
                        return false;
                    }
                    const data = await res.json();
                    const player_code = data.player_code || data.player_key;
                    if (!player_code) {
                        ui.notifications.error("Invalid response from server.");
                        return false;
                    }
                    await game.settings.set(RS_NS, "cloudPlayerKey", player_code);
                    $(ROLLSIGHT_PLAYER_FIELD_SEL).val(player_code);
                    ui.notifications.info("Player code saved — use Copy to paste into the RollSight app.");
                    return true;
                };

                const $playerRow = $playerInp.next(".rollsight-code-actions");
                if ($playerRow.length && !$playerRow.data("rollsightRefreshBound")) {
                    $playerRow.data("rollsightRefreshBound", true);
                    const $refresh = $(
                        '<button type="button" class="rollsight-code-refresh" title="Fetch player code from RollSight"><i class="fas fa-sync-alt"></i></button>'
                    );
                    $refresh.on("click", async (ev) => {
                        ev.preventDefault();
                        $refresh.prop("disabled", true);
                        try {
                            await runPlayerCodeRequest();
                        } catch (e) {
                            console.error(e);
                            ui.notifications.error("Could not reach RollSight server.");
                        } finally {
                            $refresh.prop("disabled", false);
                        }
                    });
                    $playerRow.append($refresh);
                }

                const $insertAfter = $playerGroup.length ? $playerGroup : $playerInp;
                if (!$sheet.find(".rollsight-get-player-code-block").length && $insertAfter.length) {
                    const $block = $(
                        '<div class="form-group rollsight-get-player-code-block"><p class="hint" style="margin:0 0 0.35em 0;">If your code is blank, request it from the RollSight servers:</p><div class="form-fields"></div></div>'
                    );
                    const $getBtn = $(
                        '<button type="button" class="rollsight-get-player-code"><i class="fas fa-cloud-download-alt"></i> Get my RollSight player code</button>'
                    );
                    $block.find(".form-fields").append($getBtn);
                    $insertAfter.after($block);
                    $getBtn.on("click", async (ev) => {
                        ev.preventDefault();
                        const label = "Get my RollSight player code";
                        $getBtn.prop("disabled", true).text("Requesting…");
                        try {
                            await runPlayerCodeRequest();
                        } catch (e) {
                            console.error(e);
                            ui.notifications.error("Could not reach RollSight server.");
                        } finally {
                            $getBtn.prop("disabled", false).html('<i class="fas fa-cloud-download-alt"></i> ' + label);
                        }
                    });
                }

                if (!$playerInp.data("rollsightAutoProvisionQueued")) {
                    $playerInp.data("rollsightAutoProvisionQueued", true);
                    void (async () => {
                        try {
                            await rsAutoProvisionCloudRelay(game);
                            const pk = (game.settings.get(RS_NS, "cloudPlayerKey") ?? "").toString().trim();
                            if (pk) $(ROLLSIGHT_PLAYER_FIELD_SEL).val(pk);
                        } catch (_e) {
                            /* ignore */
                        }
                    })();
                }

                if (!game.user.isGM || $sheet.find(".rollsight-gm-cloud-relay").length) return;
                const $gmAnchor = $playerGroup.length ? $playerGroup : $playerInp;
                if (!$gmAnchor.length) return;
                const linked = rsHasTableCloudRoomKey(game);
                const hint = linked
                    ? '<p class="hint" style="margin:0.25em 0 0.5em;">This world is linked to the RollSight cloud. Each person uses their own 8-character code below in the RollSight app — not shared.</p>'
                    : '<p class="hint" style="margin:0.25em 0 0.5em;">Link once so you and your players can request player codes. The table link stays behind the scenes; only personal codes go into RollSight.</p>';
                const $wrap = $(
                    `<div class="form-group rollsight-gm-cloud-relay"><label>RollSight cloud (GM)</label>${hint}<div class="form-fields"></div></div>`
                );
                const $fields = $wrap.find(".form-fields");
                if (!linked) {
                    const btn = $(
                        '<button type="button" class="rollsight-create-cloud-room"><i class="fas fa-link"></i> Link this world to RollSight cloud</button>'
                    );
                    $fields.append(btn);
                    btn.on("click", async (ev) => {
                        ev.preventDefault();
                        try {
                            const base = rsApiBase(game);
                            const res = await fetch(`${base}/rollsight-room/create`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                            });
                            if (!res.ok) {
                                ui.notifications.error("Could not link this world. Try again later.");
                                return;
                            }
                            const data = await res.json();
                            const room_code = data.room_code || data.room_key;
                            if (!room_code) {
                                ui.notifications.error("Invalid response from server.");
                                return;
                            }
                            await game.settings.set(RS_NS, "cloudRoomKey", room_code);
                            if (game.rollsight && typeof game.rollsight._autoProvisionPlayerCodeOnly === "function") {
                                await game.rollsight._autoProvisionPlayerCodeOnly();
                            } else {
                                await rsProvisionPlayerCodeOnly(game);
                            }
                            const pk = (game.settings.get(RS_NS, "cloudPlayerKey") ?? "").toString().trim();
                            $(ROLLSIGHT_PLAYER_FIELD_SEL).val(pk);
                            ui.notifications.info(
                                pk
                                    ? "World linked — your player code is filled in. Copy it into the RollSight app."
                                    : "World linked. Use “Get my RollSight player code” below if the field is still empty."
                            );
                        } catch (e) {
                            console.error(e);
                            ui.notifications.error("Could not reach RollSight server.");
                        }
                    });
                } else {
                    $fields.append($('<p class="notes" style="opacity:0.9;margin:0;">Cloud link active for this world.</p>'));
                }
                $gmAnchor.before($wrap);
            } catch (err) {
                console.error("RollSight Real Dice Reader | rollsight-settings.js Configure Settings UI failed:", err);
            }
        };

        mount();
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => mount());
        [0, 25, 50, 100, 200, 400, 800, 1500, 2500].forEach((ms) => setTimeout(mount, ms));
    };

    H.on("renderSettingsConfig", (app, html) => rsScheduleSettingsUiMount(app, html));
    H.on("renderApplication", (app, html) => {
        if (rsIsSettingsConfigApp(app)) rsScheduleSettingsUiMount(app, html);
    });
}

const HooksRef = (typeof foundry !== "undefined" && foundry.Hooks) ? foundry.Hooks : globalThis.Hooks;
const _rsRetryDelays = [0, 50, 150, 400, 1000, 2500];
if (HooksRef) {
    HooksRef.once("init", tryRegisterRollSightSchemas);
    HooksRef.once("setup", tryRegisterRollSightSchemas);
    HooksRef.once("init", registerRollSightConfigureSettingsUiHook);
    HooksRef.once("setup", registerRollSightConfigureSettingsUiHook);
}
_rsRetryDelays.forEach((ms) => setTimeout(tryRegisterRollSightSchemas, ms));
_rsRetryDelays.forEach((ms) => setTimeout(registerRollSightConfigureSettingsUiHook, ms));
