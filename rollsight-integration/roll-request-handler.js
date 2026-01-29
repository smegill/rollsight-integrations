/**
 * Roll Request Handler for Rollsight Integration
 * 
 * Handles sending roll requests to Rollsight.
 */

export class RollRequestHandler {
    constructor(module) {
        this.module = module;
        this.defaultWebhookUrl = "http://localhost:8765/foundry/roll-request";
    }

    getWebhookUrl() {
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        const url = game?.settings?.get("rollsight-integration", "rollRequestUrl");
        return (url && String(url).trim()) ? String(url).trim() : this.defaultWebhookUrl;
    }

    /**
     * Send a roll request to Rollsight (optional; only if rollRequestUrl is set)
     */
    async sendRequest(requestData) {
        const url = this.getWebhookUrl();
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(requestData)
            });
            
            if (response.ok) {
                const result = await response.json();
                console.log("Rollsight Integration | Roll request sent:", result);
                return result;
            } else {
                console.error("Rollsight Integration | Failed to send roll request:", response.statusText);
                return null;
            }
        } catch (error) {
            console.error("Rollsight Integration | Error sending roll request:", error);
            const ui = (typeof foundry !== 'undefined' && foundry.ui) ? foundry.ui : globalThis.ui;
            if (ui?.notifications) ui.notifications.warn("Could not connect to Rollsight. Make sure Rollsight is running.");
            return null;
        }
    }
}









