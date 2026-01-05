/**
 * Roll Request Handler for Rollsight Integration
 * 
 * Handles sending roll requests to Rollsight.
 */

export class RollRequestHandler {
    constructor(module) {
        this.module = module;
        this.webhookUrl = "http://localhost:8765/foundry/roll-request";
    }
    
    /**
     * Send a roll request to Rollsight
     */
    async sendRequest(requestData) {
        try {
            const response = await fetch(this.webhookUrl, {
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
            ui.notifications.warn("Could not connect to Rollsight. Make sure Rollsight is running.");
            return null;
        }
    }
    
    /**
     * Set webhook URL (for configuration)
     */
    setWebhookUrl(url) {
        this.webhookUrl = url;
    }
}




