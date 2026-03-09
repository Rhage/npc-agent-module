import { MODULE_ID } from "./constants.js";

export class NPCAgentConnectionManager extends FormApplication {
	
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id:     "npc-agent-connection-manager",
            title:  "NPC Agent — Connection",
            width:  380,
            height: "auto"
        });
    }

    async _renderInner() {
        const connected = game.npcAgent?.connected ?? false;
        const status    = connected
            ? `<span style="color:#27ae60;">● Connected</span>`
            : `<span style="color:#c0392b;">● Disconnected</span>`;

        const $html = $(`
            <div style="padding: 8px 4px;">
                <p style="margin-bottom: 16px;">
                    <strong>Status:</strong> ${status}
                </p>
                <div style="display:flex; gap:8px;">
                    <button id="npc-btn-start" ${connected  ? "disabled" : ""}>
                        <i class="fas fa-plug"></i> Start
                    </button>
                    <button id="npc-btn-stop"  ${!connected ? "disabled" : ""}>
                        <i class="fas fa-power-off"></i> Stop
                    </button>
                </div>
            </div>
        `);

        $html.find("#npc-btn-start").click(() => {
            game.npcAgent.start();
            setTimeout(() => this.render(), 600);
        });

        $html.find("#npc-btn-stop").click(() => {
            game.npcAgent.stop();
            setTimeout(() => this.render(), 300);
        });

        return $html;
    }

    async _updateObject() {}
}
