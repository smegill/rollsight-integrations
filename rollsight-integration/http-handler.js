/**
 * HTTP Handler for Rollsight Integration
 * 
 * Handles HTTP POST requests from Rollsight (for cloud-hosted Foundry instances).
 */

export class HTTPHandler {
    constructor(module) {
        this.module = module;
    }
    
    /**
     * Register HTTP routes
     */
    register() {
        // Register HTTP endpoint for receiving rolls
        // This allows external clients (like Rollsight) to send rolls via HTTP
        // instead of requiring Socket.io connection
        
        Hooks.once('ready', () => {
            // Create HTTP route handler
            // Note: Foundry doesn't have built-in HTTP route handling,
            // so we'll use a workaround with socket events triggered by HTTP requests
            
            // For now, we'll document that the module needs to be set up
            // to receive HTTP requests via a proxy or custom server
            console.log("Rollsight Integration | HTTP handler ready");
        });
    }
    
    /**
     * Handle HTTP POST request for roll
     * 
     * This would be called by a custom HTTP server or proxy
     * that forwards requests to Foundry's module system.
     */
    handleRollRequest(rollData) {
        if (this.module) {
            this.module.handleRoll(rollData);
        }
    }
}

/**
 * Alternative: Use Foundry's API system
 * 
 * Foundry modules can register API routes, but this requires
 * additional setup. For cloud-hosted instances, we recommend
 * using a webhook proxy or browser-based bridge.
 */









