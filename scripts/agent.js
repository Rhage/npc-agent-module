import { MODULE_ID, SOCKET_ID } from "./constants.js";
import { NPCAgentConnectionManager } from "./connection-manager.js";
import { NPCAgentDialog } from "./dialog.js";

class NPCAgent {
    constructor() {
        this.ws         = null;
        this.connected  = false;
        this.manualStop = false;
    }

    connect() {
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
            const actor      = game.actors.getName(data.profile);
            const targetUser = game.users.find(u => u.name === data.player);
            const formatted  = data.response.replace(/\n/g, "<br>");

            ChatMessage.create({
                content: formatted,
                type:    CONST.CHAT_MESSAGE_TYPES.IC,
                user:    targetUser?.id ?? game.user.id,
                speaker: actor
                    ? ChatMessage.getSpeaker({ actor })
                    : { alias: data.profile }
            }, {
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
            player,
            profile,
            message
        }));
    }

    openDialog(profile) {
        const existing = Object.values(ui.windows).find(w => w.id === "npc-agent-dialog");
        if (existing) {
            existing.bringToTop();
            return;
        }
        new NPCAgentDialog(profile).render(true);
    }
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

    game.settings.register(MODULE_ID, "shortPauseMs", {
        name:    "Short Pause Duration (ms)",
        hint:    "Milliseconds of silence before inserting a period. Default: 1500",
        scope:   "client",
        config:  true,
        type:    Number,
        default: 1500,
        range:   { min: 500, max: 5000, step: 100 }
    });

    game.settings.register(MODULE_ID, "longPauseMs", {
        name:    "Long Pause Duration (ms)",
        hint:    "Milliseconds of silence before inserting a paragraph break. Default: 3000",
        scope:   "client",
        config:  true,
        type:    Number,
        default: 3000,
        range:   { min: 1000, max: 10000, step: 100 }
    });
});

// ── Ready ──
Hooks.once("ready", () => {
    game.socket.on(SOCKET_ID, (data) => {
        if (game.user.isGM) {
            game.npcAgent.sendMessage(data.player, data.profile, data.message);
        }
    });

    game.npcAgent = new NPCAgent();

    if (game.user.isGM) {
        game.npcAgent.connect();
    }
});
