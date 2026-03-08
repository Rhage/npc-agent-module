const MODULE_ID = "npc-agent";
const SOCKET_ID = `module.${MODULE_ID}`;

class NPCAgent {
    constructor() {
        this.ws          = null;
        this.connected   = false;
        this.manualStop  = false;  // tracks intentional stops via dialog
    }

    connect() {
        // Don't connect if manually stopped
        if (this.manualStop) return;

        const url = game.settings.get(MODULE_ID, "serverUrl");
        console.log(`${MODULE_ID} | Connecting to ${url}...`);
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            this.connected = true;
            console.log(`${MODULE_ID} | Connected to NPC Agent server.`);
            ui.notifications.info("NPC Agent connected.");
        };

        this.ws.onclose = () => {
            this.connected = false;
            console.log(`${MODULE_ID} | Disconnected.`);

            // Only auto-reconnect if not manually stopped
            // and Auto Reconnect setting is enabled
            if (!this.manualStop && game.settings.get(MODULE_ID, "autoReconnect")) {
                console.log(`${MODULE_ID} | Auto reconnecting in 5s...`);
                setTimeout(() => this.connect(), 5000);
            }
        };

        this.ws.onerror = (err) => {
            console.error(`${MODULE_ID} | WebSocket error:`, err);
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
        };
    }

    start() {
        this.manualStop = false;
        this.connect();
    }

    stop() {
        this.manualStop = true;
        if (this.ws) {
            this.ws.close();
            this.connected = false;
            console.log(`${MODULE_ID} | Manually stopped.`);
            ui.notifications.info("NPC Agent stopped.");
        }
    }

	handleMessage(data) {
		if (data.type === "agent_response") {
			const actor = game.actors.getName(data.profile);
			const targetUser = game.users.find(u => u.name === data.player);
			const formatted = data.response.replace(/\n/g, "<br>");
			
			console.log(data.profile);
			ChatMessage.create({
				content: formatted,
				type: CONST.CHAT_MESSAGE_TYPES.IC,
				user: targetUser?.id ?? game.user.id,
				speaker: actor
					? ChatMessage.getSpeaker({ actor: actor })
					: { alias: data.profile }
			},{
				chatBubble: true
			});
		}

		if (data.type === "error") {
			ui.notifications.error(`NPC Agent: ${data.detail}`);
		}
	}

    sendMessage(player, profile, message) {
        if (!this.connected) {
            ui.notifications.warn("NPC Agent is not connected.");
            return;
        }

        this.ws.send(JSON.stringify({
            type:    "player_message",
            player:  player,
            profile: profile,
            message: message
        }));
    }
}

// ── Connection Manager Dialog ──
class NPCAgentConnectionManager extends FormApplication {
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
                    <button id="npc-btn-start"  ${connected  ? 'disabled' : ''}>
                        <i class="fas fa-plug"></i> Start
                    </button>
                    <button id="npc-btn-stop" ${!connected ? 'disabled' : ''}>
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

// ── Settings ──
Hooks.once("init", () => {
    game.settings.register(MODULE_ID, "serverUrl", {
        name:    "Server URL",
        hint:    "WebSocket URL of the NPC Agent server.",
        scope:   "world",
        config:  true,
        type:    String,
        default: "ws://127.0.0.1:8000/ws/vtt"
    });

    game.settings.register(MODULE_ID, "autoReconnect", {
        name:    "Auto Reconnect",
        hint:    "Automatically attempt to reconnect if the connection is lost mid-session.",
        scope:   "world",
        config:  true,
        type:    Boolean,
        default: true
    });

    game.settings.registerMenu(MODULE_ID, "connectionManager", {
        name:       "Connection",
        label:      "Manage Connection",
        hint:       "Manually start or stop the NPC Agent connection.",
        icon:       "fas fa-plug",
        type:       NPCAgentConnectionManager,
        restricted: true
    });
});

// ── Ready ──
Hooks.once("ready", () => {
    game.socket.on(SOCKET_ID, (data) => {
        if (game.user.isGM) {
            game.npcAgent.sendMessage(data.player, data.profile, data.message);
        }
    });

    if (game.user.isGM) {
        game.npcAgent = new NPCAgent();
        // Always attempt initial connection on startup
        game.npcAgent.connect();
    }
});