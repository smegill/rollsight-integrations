/**
 * Chat Handler for Rollsight Integration
 * 
 * Handles creation and updating of chat messages for rolls.
 */

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
            
            // Get Foundry classes (using namespaced API for Foundry v13+ if available)
            const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
            const ChatMessageClass = (typeof foundry !== 'undefined' && foundry.chat?.messages?.ChatMessage)
                ? foundry.chat.messages.ChatMessage
                : globalThis.ChatMessage;
            const CONFIG = (typeof foundry !== 'undefined' && foundry.CONFIG) ? foundry.CONFIG : globalThis.CONFIG;
            
            if (!game || !game.user) {
                throw new Error("Game or user not available");
            }
            
            const user = game.user;
            console.log("ChatHandler | User:", user.name, "ID:", user.id);
            
            // v12+ use rolls array only (avoid deprecated CONST.CHAT_MESSAGE_TYPES / CHAT_MESSAGE_STYLES.ROLL)
            const major = Number(String(game.release?.version ?? game.data?.version ?? "0").split(".")[0]) || 0;
            const useRollsOnly = major >= 12;
            const sound = (typeof CONFIG !== "undefined" && CONFIG.sounds?.dice) ? CONFIG.sounds.dice : null;
            
            const messageData = {
                user: user.id,
                speaker: ChatMessageClass.getSpeaker({ user: user }),
                ...(useRollsOnly ? { rolls: [roll] } : { type: "roll", roll }),
                ...(sound ? { sound } : {}),
                flags: {
                    "rollsight-integration": {
                        rollId: rollData.roll_id,
                        source: "rollsight"
                    }
                }
            };
            
            console.log("ChatHandler | Creating message with data:", {
                user: messageData.user,
                rolls: messageData.rolls?.length ?? messageData.roll,
                formula: roll.formula,
                total: roll.total
            });
            
            // Create the message - Foundry will automatically render the roll
            const message = await ChatMessageClass.create(messageData);
            console.log("✅ ChatHandler | Message created successfully, ID:", message.id);
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
        ui.notifications.info("Roll corrected by Rollsight");
    }
}



