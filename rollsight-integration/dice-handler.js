/**
 * Dice Handler for Rollsight Integration
 * 
 * Handles 3D dice animations for physical rolls.
 */

export class DiceHandler {
    constructor(module) {
        this.module = module;
    }
    
    /**
     * Animate 3D dice for a roll
     */
    animateDice(roll) {
        // Check if 3D dice are enabled (using namespaced API for Foundry v13+ if available)
        const game = (typeof foundry !== 'undefined' && foundry.game) ? foundry.game : globalThis.game;
        if (!game.settings.get("core", "dice3d")) {
            return; // 3D dice not enabled
        }
        
        // Check if Dice3D module is available
        if (typeof Dice3D === "undefined") {
            return; // Dice3D not available
        }
        
        try {
            // Create 3D dice animation
            const dice3d = new Dice3D();
            
            // Get dice terms from roll
            const terms = roll.terms || [];
            
            // Animate each die (using namespaced API for Foundry v13+ if available)
            const DieClass = (typeof foundry !== 'undefined' && foundry.dice?.terms?.Die)
                ? foundry.dice.terms.Die
                : globalThis.Die;
            for (const term of terms) {
                if (term instanceof DieClass) {
                    for (const result of term.results || []) {
                        if (result.active && !result.discarded) {
                            dice3d.showForRoll(roll, game.user, true, term.faces, [result.result]);
                        }
                    }
                }
            }
        } catch (error) {
            console.warn("Rollsight Integration | Error animating dice:", error);
        }
    }
}



