/**
 * Chat Handler for RollSight Integration
 * 
 * Handles creation and updating of chat messages for rolls.
 */

import { normalizeRollProofUrl, rollReplaySerializablePayload } from './roll-proof-html.js';

export class ChatHandler {
    constructor(module) {
        this.module = module;
    }
    
    /**
     * Create a chat message for a roll
     * Uses Foundry's native roll rendering system (like dddice does)
     */
    async createRollMessage(roll, rollData) {
        try {
            console.log("ChatHandler | Creating roll message for:", roll.formula, "=", roll.total);
            
            // Get Foundry classes (v12: game.messages.documentClass; v13+: foundry.chat.messages.ChatMessage)
            const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
            const ChatMessageClass = game?.messages?.documentClass
                ?? (typeof foundry !== 'undefined' && foundry.chat?.messages?.ChatMessage)
                ?? globalThis.ChatMessage;
            const CONFIG = (typeof foundry !== 'undefined' && foundry.CONFIG) ? foundry.CONFIG : globalThis.CONFIG;
            
            if (!game || !game.user) {
                throw new Error("Game or user not available");
            }
            
            if (!ChatMessageClass) {
                throw new Error("ChatMessage document class not available (Foundry may not be fully ready)");
            }
            
            const user = game.user;
            console.log("ChatHandler | User:", user.name, "ID:", user.id);
            
            // v12+ use rolls array only (avoid deprecated CONST.CHAT_MESSAGE_TYPES / CHAT_MESSAGE_STYLES.ROLL)
            const major = Number(String(game.release?.version ?? game.data?.version ?? "0").split(".")[0]) || 0;
            const useRollsOnly = major >= 12;
            const sound = (typeof CONFIG !== "undefined" && CONFIG.sounds?.dice) ? CONFIG.sounds.dice : null;
            
            let speaker;
            try {
                speaker = (typeof ChatMessageClass.getSpeaker === "function")
                    ? ChatMessageClass.getSpeaker({ user })
                    : { alias: user?.name ?? "Unknown" };
            } catch (e) {
                speaker = { alias: user?.name ?? "Unknown" };
            }
            
            const rpPayload = rollReplaySerializablePayload(rollData);
            const messageData = {
                user: user.id,
                speaker,
                ...(useRollsOnly ? { rolls: [roll] } : { type: "roll", roll }),
                ...(sound ? { sound } : {}),
                flags: {
                    "rollsight-integration": {
                        rollId: rollData.roll_id,
                        source: "rollsight",
                        ...(rpPayload
                            ? {
                                rollReplayPayload: rpPayload,
                                rollProofUrl: normalizeRollProofUrl(rpPayload.roll_proof_url) || rpPayload.roll_proof_url,
                            }
                            : {}),
                    }
                }
            };
            
            console.log("ChatHandler | Creating message with data:", {
                user: messageData.user,
                rolls: messageData.rolls?.length ?? messageData.roll,
                formula: roll.formula,
                total: roll.total
            });

            // v12+ validation: "Roll objects added to ChatMessage documents must be evaluated"
            if (useRollsOnly && roll && roll._evaluated !== true) {
                const tt = roll.total ?? roll._total;
                if (typeof tt === "number" && !Number.isNaN(tt)) {
                    roll._evaluated = true;
                    if (roll._total == null || Number.isNaN(roll._total)) roll._total = tt;
                }
            }
            
            // Create the message - Foundry will automatically render the roll
            const message = await ChatMessageClass.create(messageData);
            if (message?.id) {
                console.log("✅ ChatHandler | Message created successfully, ID:", message.id);
            }
            return message;
        } catch (error) {
            console.error("❌ ChatHandler | Error creating roll message:", error);
            console.error("❌ ChatHandler | Error stack:", error.stack);
            throw error;
        }
    }
    
    /**
     * Update an existing chat message with corrected roll
     */
    async updateRollMessage(chatMessage, correctedRoll, rollData) {
        // Build updated content
        const content = await renderTemplate(
            "modules/rollsight-integration/templates/roll-message.html",
            {
                roll: correctedRoll,
                formula: rollData.formula || correctedRoll.formula,
                total: correctedRoll.total,
                dice: rollData.dice || [],
                rollId: rollData.roll_id,
                corrected: true
            }
        );
        
        // Update the message
        await chatMessage.update({
            content: content,
            roll: correctedRoll
        });
        
        // Show notification (using namespaced API for Foundry v13+ if available)
        const ui = (typeof foundry !== 'undefined' && foundry.ui) ? foundry.ui : globalThis.ui;
        ui.notifications.info("Roll corrected by RollSight");
    }
}


