/**
 * Rollsight Integration for Foundry VTT
 *
 * Receives physical dice rolls from Rollsight and integrates them into Foundry.
 * Uses Foundry v12+ Dice Fulfillment so rolls apply in-context (spells, attacks, saves).
 */

import { SocketHandler } from './socket-handler.js';
import { ChatHandler } from './chat-handler.js';
import { DiceHandler } from './dice-handler.js';
import { RollRequestHandler } from './roll-request-handler.js';
import {
    registerFulfillmentMethod,
    tryFulfillActiveResolver
} from './fulfillment-provider.js';

class RollsightIntegration {
    constructor() {
        this.socketHandler = new SocketHandler(this);
        this.chatHandler = new ChatHandler(this);
        this.diceHandler = new DiceHandler(this);
        this.rollRequestHandler = new RollRequestHandler(this);
        
        this.connected = false;
        this.rollHistory = new Map(); // Track rolls by ID for amendments
    }
    
    /**
     * Initialize the module
     */
    init() {
        console.log("Rollsight Integration | Initializing...");
        
        // Register socket handlers
        this.socketHandler.register();
        
        // Register Hooks (using namespaced API for Foundry v13+ if available)
        const Hooks = (typeof foundry !== 'undefined' && foundry.Hooks) ? foundry.Hooks : globalThis.Hooks;
        Hooks.once('ready', () => {
            this.onReady();
            // Make API available globally (using namespaced API for Foundry v13+ if available)
            const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
            game.rollsight = this;
            
            // Listen for messages from browser extension (via window.postMessage)
            // When RollResolver opens for a roll, optionally notify Rollsight (if URL set)
            Hooks.on('renderRollResolver', (resolver, _element, _data) => {
                const url = game.settings.get("rollsight-integration", "rollRequestUrl");
                if (!url || !String(url).trim()) return;
                const roll = resolver.roll || resolver.object?.roll;
                if (!roll?.formula) return;
                const requestData = {
                    vtt: "Foundry VTT",
                    formula: roll.formula,
                    roll_type: "fulfillment",
                    context: { description: "Pending roll (Rollsight fulfillment)" },
                    request_id: (typeof foundry !== 'undefined' && foundry.utils?.randomID) ? foundry.utils.randomID() : crypto.randomUUID?.() ?? `req-${Date.now()}`
                };
                this.rollRequestHandler.sendRequest(requestData).catch(() => {});
            });

            window.addEventListener('message', (event) => {
                // Only accept messages from our extension or same origin
                if (event.data && event.data.type === 'rollsight-roll') {
                    console.log("Rollsight Integration | Received roll via postMessage:", event.data.rollData);
                    this.handleRoll(event.data.rollData).catch(error => {
                        console.error("Rollsight Integration | Error handling roll from postMessage:", error);
                    });
                } else if (event.data && event.data.type === 'rollsight-amendment') {
                    console.log("Rollsight Integration | Received amendment via postMessage:", event.data.amendmentData);
                    this.handleAmendment(event.data.amendmentData).catch(error => {
                        console.error("Rollsight Integration | Error handling amendment from postMessage:", error);
                    });
                } else if (event.data && event.data.type === 'rollsight-test') {
                    console.log("🎲 Rollsight Integration | Received test message request");
                    this.sendTestMessage().catch(error => {
                        console.error("Rollsight Integration | Error sending test message:", error);
                    });
                }
            });
        });
    }
    
    /**
     * Called when Foundry is ready
     */
    onReady() {
        console.log("Rollsight Integration | Ready");
        
        // Check if we should auto-connect (using namespaced API for Foundry v13+ if available)
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        const autoConnect = game.settings.get("rollsight-integration", "autoConnect");
        if (autoConnect) {
            this.connect();
        }
    }
    
    /**
     * Connect to Rollsight
     */
    connect() {
        this.socketHandler.connect();
    }
    
    /**
     * Disconnect from Rollsight
     */
    disconnect() {
        this.socketHandler.disconnect();
    }
    
    /**
     * Check if connected to Rollsight
     */
    isConnected() {
        return this.connected;
    }
    
    /**
     * Handle incoming roll from Rollsight.
     * If a RollResolver is active (e.g. attack/spell roll), fulfill it in-context;
     * otherwise fall back to chat.
     */
    async handleRoll(rollData) {
        console.log("Rollsight Integration | Received roll:", rollData);

        try {
            const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
            const fallbackToChat = game?.settings?.get("rollsight-integration", "fallbackToChat") !== false;

            // Try to feed the active RollResolver (Foundry v12+ fulfillment)
            const consumed = tryFulfillActiveResolver(rollData);
            if (consumed) {
                console.log("Rollsight Integration | Roll fulfilled in-context (RollResolver)");
                const foundryRoll = this.createFoundryRoll(rollData);
                if (foundryRoll) this.diceHandler.animateDice(foundryRoll);
                return foundryRoll;
            }

            // No active resolver: fall back to chat if enabled
            if (fallbackToChat) {
                await this.sendRollAsCommand(rollData);
            } else {
                console.log("Rollsight Integration | No pending roll and fallback disabled; roll not sent.");
            }
            return null;
            
            /* Original code - commented out for testing
            // Create Foundry Roll from roll data
            console.log("Rollsight Integration | Creating Foundry Roll...");
            const foundryRoll = this.createFoundryRoll(rollData);
            console.log("Rollsight Integration | Roll created:", foundryRoll.formula, "=", foundryRoll.total);
            
            // Store in history for potential amendments
            if (rollData.roll_id) {
                this.rollHistory.set(rollData.roll_id, {
                    roll: foundryRoll,
                    rollData: rollData,
                    chatMessage: null // Will be set when message is created
                });
            }
            
            // Create chat message (await to ensure it's created before continuing)
            console.log("Rollsight Integration | Creating chat message...");
            const chatMessage = await this.chatHandler.createRollMessage(foundryRoll, rollData);
            console.log("Rollsight Integration | Chat message created:", chatMessage.id);
            
            // Store chat message reference
            if (rollData.roll_id && this.rollHistory.has(rollData.roll_id)) {
                this.rollHistory.get(rollData.roll_id).chatMessage = chatMessage;
            }
            
            // Trigger 3D dice (after message is created)
            this.diceHandler.animateDice(foundryRoll);
            
            console.log("✅ Rollsight Integration | Roll processed successfully and should appear in chat");
            return foundryRoll;
            */
        } catch (error) {
            console.error("❌ Rollsight Integration | Error handling roll:", error);
            console.error("❌ Rollsight Integration | Error stack:", error.stack);
            throw error;
        }
    }
    
    /**
     * Send roll as /roll command in Foundry chat
     */
    async sendRollAsCommand(rollData) {
        try {
            console.log("🎲 Rollsight Integration | Sending roll as /roll command...");
            
            // Get Foundry classes (using namespaced API for Foundry v13+ if available)
            const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
            
            if (!game || !game.user) {
                throw new Error("Game or user not available");
            }
            
            const user = game.user;
            
            // Get the total value and formula
            const total = rollData.total !== undefined ? rollData.total : 0;
            const formula = rollData.formula || '1d6';
            
            // Build description using same logic as Pico display
            // - Pair d10p + d10 for percentile (d100)
            // - Handle 2 d20s as advantage/disadvantage
            let description = 'Rollsight Roll';
            
            if (rollData.dice && rollData.dice.length > 0) {
                // Separate dice by type
                const d10pDice = [];
                const d10Dice = [];
                const d20Dice = [];
                const otherDice = [];
                
                rollData.dice.forEach(d => {
                    const shape = d.shape || (d.faces ? `d${d.faces}` : null);
                    const value = d.value;
                    
                    if (shape === 'd10p') {
                        d10pDice.push({ shape, value });
                    } else if (shape === 'd10') {
                        d10Dice.push({ shape, value });
                    } else if (shape === 'd20') {
                        d20Dice.push({ shape, value });
                    } else {
                        otherDice.push({ shape, value });
                    }
                });
                
                const parts = [];
                
                // Pair d10p + d10 for percentile (like Pico display)
                const pairsToMake = Math.min(d10pDice.length, d10Dice.length);
                for (let i = 0; i < pairsToMake; i++) {
                    const d10pValue = d10pDice[i].value;
                    const d10Value = d10Dice[i].value;
                    
                    // Calculate percentile value (same logic as Pico display)
                    let percentileValue;
                    const d10Adjusted = (d10Value === 10) ? 0 : d10Value; // d10 "0" is stored as 10
                    
                    if (d10pValue === 0 && d10Adjusted === 0) {
                        percentileValue = 100; // 00 + 0 = 100
                    } else if (d10pValue === 0) {
                        percentileValue = d10Adjusted; // 00 + 1-9 = that digit
                    } else {
                        percentileValue = d10pValue + d10Adjusted; // d10p + d10
                    }
                    
                    parts.push(`d100: ${percentileValue} (d10p: ${d10pValue}, d10: ${d10Value})`);
                }
                
                // Handle 2 d20s as advantage/disadvantage
                if (d20Dice.length === 2) {
                    const [d20a, d20b] = d20Dice;
                    const higher = Math.max(d20a.value, d20b.value);
                    const lower = Math.min(d20a.value, d20b.value);
                    parts.push(`d20: ${higher}/${lower} (ADV)`);
                } else if (d20Dice.length === 1) {
                    const d20Value = d20Dice[0].value;
                    parts.push(`d20: ${d20Value}`);
                }
                
                // Add remaining unpaired d10p dice
                for (let i = pairsToMake; i < d10pDice.length; i++) {
                    parts.push(`d10p: ${d10pDice[i].value}`);
                }
                
                // Add remaining unpaired d10 dice
                for (let i = pairsToMake; i < d10Dice.length; i++) {
                    parts.push(`d10: ${d10Dice[i].value}`);
                }
                
                // Add all other dice
                otherDice.forEach(d => {
                    const shape = d.shape || '?';
                    parts.push(`${shape}: ${d.value}`);
                });
                
                if (parts.length > 0) {
                    description = `Rollsight Roll: ${parts.join(', ')}`;
                }
            } else if (formula) {
                description = `Rollsight Roll: ${formula}`;
            }
            
            // Create /roll command: /roll [total] # [description]
            const rollCommand = `/roll ${total} # ${description}`;
            
            console.log("🎲 Rollsight Integration | Sending roll command:", rollCommand);
            
            // Send the command to chat - Foundry will process it as a roll
            // Use ui.chat.processMessage to process the command
            const ui = (typeof foundry !== 'undefined' && foundry.ui) ? foundry.ui : globalThis.ui;
            if (ui && ui.chat && ui.chat.processMessage) {
                await ui.chat.processMessage(rollCommand);
                console.log("✅ Rollsight Integration | Roll command processed successfully");
            } else {
                // Fallback: create a ChatMessage with the command as content
                const ChatMessageClass = (typeof foundry !== 'undefined' && foundry.chat?.messages?.ChatMessage)
                    ? foundry.chat.messages.ChatMessage
                    : globalThis.ChatMessage;
                
                const messageData = {
                    user: user.id,
                    speaker: ChatMessageClass.getSpeaker({ user: user }),
                    content: rollCommand
                };
                
                const message = await ChatMessageClass.create(messageData);
                console.log("✅ Rollsight Integration | Roll command sent as message, ID:", message.id);
            }
        } catch (error) {
            console.error("❌ Rollsight Integration | Error sending roll as command:", error);
            console.error("❌ Rollsight Integration | Error stack:", error.stack);
            throw error;
        }
    }
    
    /**
     * Handle roll amendment from Rollsight
     */
    async handleAmendment(amendmentData) {
        console.log("Rollsight Integration | Received amendment:", amendmentData);
        
        const rollId = amendmentData.roll_id;
        const historyEntry = this.rollHistory.get(rollId);
        
        if (!historyEntry) {
            console.warn("Rollsight Integration | Amendment for unknown roll:", rollId);
            return Promise.resolve(); // Return resolved promise instead of undefined
        }
        
        try {
            // Create corrected Foundry Roll
            const correctedRoll = this.createFoundryRoll(amendmentData.corrected);
            
            // Update chat message
            if (historyEntry.chatMessage) {
                await this.chatHandler.updateRollMessage(
                    historyEntry.chatMessage,
                    correctedRoll,
                    amendmentData.corrected
                );
            }
            
            // Update history
            historyEntry.roll = correctedRoll;
            historyEntry.rollData = amendmentData.corrected;
            
            // Re-animate dice with corrected values
            this.diceHandler.animateDice(correctedRoll);
        } catch (error) {
            console.error("❌ Rollsight Integration | Error handling amendment:", error);
            console.error("❌ Rollsight Integration | Error stack:", error.stack);
            throw error;
        }
    }
    
    /**
     * Send a test chat message to verify communication works
     */
    async sendTestMessage() {
        try {
            console.log("🎲 Rollsight Integration | Sending test chat message...");
            
            // Get Foundry classes (using namespaced API for Foundry v13+ if available)
            const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
            const ChatMessageClass = (typeof foundry !== 'undefined' && foundry.chat?.messages?.ChatMessage)
                ? foundry.chat.messages.ChatMessage
                : globalThis.ChatMessage;
            
            if (!game || !game.user) {
                throw new Error("Game or user not available");
            }
            
            const user = game.user;
            console.log("🎲 Rollsight Integration | User:", user.name, "ID:", user.id);
            
            // Create a simple text message
            const messageData = {
                user: user.id,
                speaker: ChatMessageClass.getSpeaker({ user: user }),
                content: "<p><strong>🎲 Rollsight Test Message</strong><br/>If you see this, communication is working!</p>",
                sound: null
            };
            
            console.log("🎲 Rollsight Integration | Creating test message with data:", messageData);
            
            const message = await ChatMessageClass.create(messageData);
            console.log("✅ Rollsight Integration | Test message created successfully, ID:", message.id);
            return message;
        } catch (error) {
            console.error("❌ Rollsight Integration | Error sending test message:", error);
            console.error("❌ Rollsight Integration | Error stack:", error.stack);
            throw error;
        }
    }
    
    /**
     * Create a Foundry Roll from Rollsight roll data
     * Uses Foundry's manual dice entry approach - create terms with results already set
     */
    createFoundryRoll(rollData) {
        // Get Foundry classes (using namespaced API for Foundry v13+ if available)
        const RollClass = (typeof foundry !== 'undefined' && foundry.dice?.rolls?.Roll)
            ? foundry.dice.rolls.Roll
            : globalThis.Roll;
        
        // Get formula
        const formula = rollData.formula || this.buildFormula(rollData);
        
        // Create roll from formula first
        let roll;
        if (RollClass.fromFormula) {
            roll = RollClass.fromFormula(formula);
        } else {
            roll = new RollClass(formula);
        }
        
        // If we have dice data, manually set the results (like manual dice entry)
        if (rollData.dice && rollData.dice.length > 0) {
            const DieClass = (typeof foundry !== 'undefined' && foundry.dice?.terms?.Die) 
                ? foundry.dice.terms.Die 
                : globalThis.Die;
            
            // Collect all die values
            const dieValues = [];
            for (const dieData of rollData.dice) {
                let value;
                if (dieData.value !== undefined) {
                    value = dieData.value;
                } else if (dieData.results && dieData.results.length > 0) {
                    value = dieData.results[0];
                } else {
                    continue;
                }
                dieValues.push(value);
            }
            
            // Set results on each die term
            // Note: Foundry groups multiple dice of same type into one Die term
            let valueIndex = 0;
            for (const term of roll.terms) {
                if (term instanceof DieClass) {
                    // This is a Die term - set results for all dice in this term
                    const results = [];
                    const numDice = term.number || 1;
                    for (let i = 0; i < numDice && valueIndex < dieValues.length; i++) {
                        results.push({
                            result: dieValues[valueIndex],
                            active: true,
                            discarded: false
                        });
                        valueIndex++;
                    }
                    // Set results array
                    term.results = results;
                    // Mark as evaluated
                    term._evaluated = true;
                }
            }
        }
        
        // Mark roll as evaluated (results are already set, like manual entry)
        // Note: isDeterministic is read-only and calculated automatically
        roll._evaluated = true;
        
        return roll;
    }
    
    /**
     * Build formula string from roll data
     */
    buildFormula(rollData) {
        const parts = [];
        for (const dieTerm of rollData.dice || []) {
            parts.push(`${dieTerm.number || dieTerm.results.length}d${dieTerm.faces}`);
        }
        return parts.join("+") || "1d6";
    }
    
    /**
     * Request a roll from Rollsight
     */
    async requestRoll(formula, options = {}) {
        const requestData = {
            vtt: "Foundry VTT",
            formula: formula,
            roll_type: options.rollType || "normal",
            context: {
                description: options.description || "",
                actor: options.actor?.name || "",
                item: options.item?.name || ""
            },
            request_id: foundry.utils.randomID()
        };
        
        // Send to Rollsight webhook
        return this.rollRequestHandler.sendRequest(requestData);
    }
}

// Register fulfillment method in setup (CONFIG.Dice.fulfillment is set there)
const Hooks = (typeof foundry !== 'undefined' && foundry.Hooks) ? foundry.Hooks : globalThis.Hooks;
Hooks.once('setup', () => {
    registerFulfillmentMethod();
});

// Register settings and initialize in 'init'
Hooks.once('init', () => {
    const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
    game.settings.register("rollsight-integration", "autoConnect", {
        name: "Auto-connect to Rollsight",
        hint: "Automatically connect to Rollsight when the game loads",
        scope: "world",
        config: true,
        type: Boolean,
        default: false
    });
    game.settings.register("rollsight-integration", "fallbackToChat", {
        name: "Fallback to chat when no pending roll",
        hint: "If no RollResolver is open (e.g. no attack/spell roll waiting), send Rollsight rolls to chat. Disable to only fulfill in-context rolls.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });
    game.settings.register("rollsight-integration", "rollRequestUrl", {
        name: "Roll request URL (optional)",
        hint: "URL Rollsight listens on for roll requests (e.g. http://localhost:8765/foundry/roll-request). Leave blank to disable.",
        scope: "world",
        config: true,
        type: String,
        default: ""
    });

    const rollsight = new RollsightIntegration();
    rollsight.init();
});

