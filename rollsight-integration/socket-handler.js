/**
 * Socket Handler for Rollsight Integration
 * 
 * Handles Socket.io communication with Rollsight.
 */

export class SocketHandler {
    constructor(module) {
        this.module = module;
        this.socket = null;
        this.connected = false;
    }
    
    /**
     * Register socket handlers
     */
    register() {
        // Register custom socket events (using namespaced API for Foundry v13+ if available)
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        game.socket.on("module.rollsight-integration", this.handleSocketEvent.bind(this));
    }
    
    /**
     * Connect to Rollsight via Socket.io
     * 
     * Note: This is a placeholder - actual connection would be established
     * by Rollsight connecting to Foundry, not the other way around.
     * Rollsight emits events that Foundry listens for.
     */
    connect() {
        // Rollsight connects to Foundry, so we just mark as ready
        this.connected = true;
        this.module.connected = true;
        console.log("Rollsight Integration | Ready to receive rolls from Rollsight");
    }
    
    /**
     * Disconnect
     */
    disconnect() {
        this.connected = false;
        this.module.connected = false;
    }
    
    /**
     * Handle socket events from Rollsight
     * 
     * Rollsight will emit events via Foundry's socket system.
     * We listen for 'rollsight:roll' and 'rollsight:amendment' events.
     */
    handleSocketEvent(data) {
        if (data.type === "roll") {
            this.handleRoll(data.rollData);
        } else if (data.type === "amendment") {
            this.handleAmendment(data.amendmentData);
        }
    }
    
    /**
     * Handle incoming roll event
     */
    handleRoll(rollData) {
        if (!this.connected) {
            console.warn("Rollsight Integration | Received roll but not connected");
            return;
        }
        
        this.module.handleRoll(rollData);
    }
    
    /**
     * Handle amendment event
     */
    handleAmendment(amendmentData) {
        if (!this.connected) {
            console.warn("Rollsight Integration | Received amendment but not connected");
            return;
        }
        
        this.module.handleAmendment(amendmentData);
    }
}

/**
 * Hook into Foundry's socket system to receive Rollsight events
 * 
 * Rollsight will emit events that we can catch via Foundry's hook system.
 * We'll use a custom hook that Rollsight can call.
 * (Using namespaced API for Foundry v13+ if available)
 */
const Hooks = (typeof foundry !== 'undefined' && foundry.Hooks) ? foundry.Hooks : globalThis.Hooks;
Hooks.on("rollsight.roll", async (rollData) => {
    const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
    const module = game.rollsight;
    if (module) {
        try {
            await module.handleRoll(rollData);
        } catch (error) {
            console.error("Rollsight Integration | Error in hook handler:", error);
        }
    }
});

Hooks.on("rollsight.amendment", (amendmentData) => {
    const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
    const module = game.rollsight;
    if (module) {
        module.handleAmendment(amendmentData);
    }
});



