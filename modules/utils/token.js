import { Sidekick } from "../sidekick.js";
import { NAME, SETTING_KEYS, DEFAULT_CONFIG, FLAGS } from "../butler.js";
import { MightySummoner } from "../mighty-summoner.js";

export class TokenUtility {
    /**
     * Handle Token create hook
     * @param {*} token 
     * @param {*} options 
     * @param {*} userId 
     * @returns 
     */
    static async _onCreateToken(token, options, userId) {
        const actor = token.actor;
        
        const mightySummonerSetting = Sidekick.getSetting(SETTING_KEYS.tokenUtility.mightySummoner);
        const tempCombatantSetting = Sidekick.getSetting(SETTING_KEYS.tempCombatants.enable);
        const tempCombatantFlag = token.getFlag(NAME, FLAGS.temporaryCombatants.temporaryCombatant);

        if (!actor || (tempCombatantSetting && tempCombatantFlag) || game.userId !== userId) {
            return;
        }

        const summonerFeat = Sidekick.getSetting(SETTING_KEYS.tokenUtility.mightySummonerFeat);

        if (mightySummonerSetting && MightySummoner._checkForFeat(actor, summonerFeat)) {
            return MightySummoner._createDialog(token);
        }

        if (TokenUtility._shouldRollHP(token)) {
            return TokenUtility._processHPUpdate(token, actor);
        }        
    }

    /**
     * Checks if the given token HP should be rolled
     * @param {*} token 
     * @returns 
     */
    static _shouldRollHP(token) {
        const actor = token?.actor;
        const autoRollHP = Sidekick.getSetting(SETTING_KEYS.tokenUtility.autoRollHP);

        if (actor && token?.data?.disposition === -1 && autoRollHP && !actor?.hasPlayerOwner) {
            return true;
        }

        return false;
    }

    /**
     * Rolls for HP then updates the given token
     * @param {*} token 
     * @param {*} actor 
     * @returns 
     */
    static async _processHPUpdate(token, actor=null, formula=null) {
        actor = actor ?? token?.actor;
        const newHP = await TokenUtility.rollHP(actor, formula);
        const hpUpdate = TokenUtility._buildHPData(newHP);

        if (!hpUpdate) return;

        return token.update(hpUpdate);
    }

    /**
     * Rolls an actor's hp formula and returns an update payload with the result
     * @param {*} actor
     */
    static async rollHP(actor, newFormula=null) {
        const formula = newFormula || getProperty(actor, "data.data.attributes.hp.formula");

        if (!formula) {
            const maxHP = getProperty(actor, "data.data.attributes.hp.max");
            return maxHP ?? 0;
        }

        const roll = new Roll(formula);
        await roll.evaluate();
        const hideRoll = Sidekick.getSetting(SETTING_KEYS.tokenUtility.hideAutoRoll);

        await roll.toMessage(
            {
                flavor: `${actor.name} rolls for HP!`
            },
            {
                rollMode: hideRoll ? `gmroll` : `roll`,
                speaker: ChatMessage.getSpeaker({actor}),
            }
        );
        const hp = roll.total;

        return hp;
    }

    /**
     * For a given hp value, build an object with hp value and max set
     * @param {*} hp 
     */
    static _buildHPData(hp) {
        const hpData = {
            actorData: {
                data: {
                    attributes: {
                        hp: {
                            value: hp,
                            max: hp
                        }
                    }
                }
            }
        };

        return hpData;
    }

    /**
     * Patch core methods
     */
    static patchCore() {
        Token.prototype._drawEffect = TokenUtility._drawEffect;
        TokenHUD.prototype._getStatusEffectChoices = TokenUtility._getStatusEffectChoices;
    }

    /**
     * Draw a status effect icon
     * @return {Promise<void>}
     * @private
     */
    static async _drawEffect(src, i, bg, w, tint) {
        const effectSize = Sidekick.getSetting(SETTING_KEYS.tokenUtility.effectSize); 

        // Use the default values if no setting found
        const multiplier = effectSize ? DEFAULT_CONFIG.tokenUtility.effectSize[effectSize].multiplier : 2;
        const divisor = effectSize ? DEFAULT_CONFIG.tokenUtility.effectSize[effectSize].divisor : 5;

        // By default the width is multipled by 2, so divide by 2 first then use the new multiplier
        w = (w / 2) * multiplier;

        let tex = await loadTexture(src, {fallback: 'icons/svg/hazard.svg'});
        let icon = this.hud.effects.addChild(new PIXI.Sprite(tex));
        icon.width = icon.height = w;
        //const nr = Math.floor(this.data.height * 5);
        const nr = Math.floor(this.data.height * divisor);
        icon.x = Math.floor(i / nr) * w;
        icon.y = (i % nr) * w;
        if ( tint ) icon.tint = tint;
        bg.drawRoundedRect(icon.x + 1, icon.y + 1, w - 2, w - 2, 2);
    }

    /**
     * Get an array of icon paths which represent valid status effect choices
     * @private
     */
    static _getStatusEffectChoices() {
        const token = this.object;

        // Get statuses which are active for the token actor
        const actor = token.actor || null;
        const statuses = actor ? actor.effects.reduce((obj, e) => {
            const id = e.getFlag("core", "statusId");
            if ( id ) {
                obj[id] = {
                    id: id,
                    overlay: !!e.getFlag("core", "overlay")
                }
            }
            return obj;
        }, {}) : {};
    
        // Prepare the list of effects from the configured defaults and any additional effects present on the Token
        const tokenEffects = foundry.utils.deepClone(token.data.effects) || [];
        if ( token.data.overlayEffect ) tokenEffects.push(token.data.overlayEffect);
        return CONFIG.statusEffects.concat(tokenEffects).reduce((obj, e) => {
            const src = e.icon ?? e;
            //if ( src in obj ) return obj;
            const status = statuses[e.id] || {};
            const isActive = !!status.id || token.data.effects.includes(src);
            const isOverlay = !!status.overlay || token.data.overlayEffect === src;
            obj[src] = {
                id: e.id ?? "",
                title: e.label ? game.i18n.localize(e.label) : null,
                src,
                isActive,
                isOverlay,
                cssClass: [
                    isActive ? "active" : null,
                    isOverlay ? "overlay" : null
                ].filterJoin(" ")
            };
            return obj;
        }, {});
    }
}