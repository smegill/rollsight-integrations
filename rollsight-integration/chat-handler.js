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
            const CONST = (typeof foundry !== 'undefined' && foundry.CONST) ? foundry.CONST : globalThis.CONST;
            const CONFIG = (typeof foundry !== 'undefined' && foundry.CONFIG) ? foundry.CONFIG : globalThis.CONFIG;
            
            if (!game || !game.user) {
                throw new Error("Game or user not available");
            }
            
            const user = game.user;
            console.log("ChatHandler | User:", user.name, "ID:", user.id);
            
            // Use Foundry's built-in roll rendering instead of custom template
            // This ensures compatibility with other modules and proper roll display
            const messageData = {
                user: user.id,
                speaker: ChatMessageClass.getSpeaker({ user: user }),
                type: CONST.CHAT_MESSAGE_TYPES.ROLL,
                roll: roll,  // Foundry will render this automatically
                sound: CONFIG.sounds.dice,
                flags: {
                    "rollsight-integration": {
                        rollId: rollData.roll_id,
                        source: "rollsight"
                    }
                }
            };
            
            console.log("ChatHandler | Creating message with data:", {
                user: messageData.user,
                type: messageData.type,
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



