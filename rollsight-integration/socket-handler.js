/**
 * Socket Handler for RollSight Integration
 * 
 * Handles Socket.io communication with RollSight.
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
        // Register custom socket events (using namespaced API for Foundry v13+ if available).
        // In v12, game.socket may not be available at setup; callers should wrap in try/catch.
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        if (!game?.socket) {
            throw new Error("game.socket not available (Foundry may not be ready)");
        }
        game.socket.on("module.rollsight-integration", this.handleSocketEvent.bind(this));
    }
    
    /**
     * Connect to RollSight via Socket.io
     * 
     * Note: This is a placeholder - actual connection would be established
     * by RollSight connecting to Foundry, not the other way around.
     * RollSight emits events that Foundry listens for.
     */
    connect() {
        // RollSight connects to Foundry, so we just mark as ready
        this.connected = true;
        this.module.connected = true;
        console.log("RollSight Integration | Ready to receive rolls from RollSight");
    }
    
    /**
     * Disconnect
     */
    disconnect() {
        this.connected = false;
        this.module.connected = false;
    }
    
    /**
     * Handle socket events from RollSight
     * 
     * RollSight will emit events via Foundry's socket system.
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
            console.warn("RollSight Integration | Received roll but not connected");
            return;
        }
        
        this.module.handleRoll(rollData);
    }
    
    /**
     * Handle amendment event
     */
    handleAmendment(amendmentData) {
        if (!this.connected) {
            console.warn("RollSight Integration | Received amendment but not connected");
            return;
        }
        
        this.module.handleAmendment(amendmentData);
    }
}

/**
 * Hook into Foundry's socket system to receive RollSight events
 * 
 * RollSight will emit events that we can catch via Foundry's hook system.
 * We'll use a custom hook that RollSight can call.
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
            console.error("RollSight Integration | Error in hook handler:", error);
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



