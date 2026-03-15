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
			const formatted  = data.response.replace(/\n/g, "<br>");
			const targetUser = game.users.get(data.userId);

			ChatMessage.create({
				content: formatted,
				type:    CONST.CHAT_MESSAGE_STYLES.IC,
				user:    targetUser?.id ?? game.user.id,
				speaker: actor
					? ChatMessage.getSpeaker({ actor })
					: { alias: data.profile }
			}, {
				chatBubble: true
			});

			// Play voice audio for all players if provided
			if (data.audio_src) {
				AudioHelper.play({
					src:      data.audio_src,
					volume:   1.0,
					autoplay: true,
					loop:     false
				}, true);  // true = push to all connected players
			}
		}

		if (data.type === "error") {
			ui.notifications.error(`NPC Agent: ${data.detail}`);
		}
	}

	sendMessage(player, profile, message, userId = game.user.id) {
		if (!this.connected) {
			ui.notifications.warn("NPC Agent is not connected.");
			return;
		}
		// Find the user who owns the speaker actor
		const targetUser = game.users.get(userId);

		console.log(player);
		ChatMessage.create({
			content: message,
			type:    CONST.CHAT_MESSAGE_STYLES.IC,
			user: targetUser?.id ?? game.user.id,
			speaker: ChatMessage.getSpeaker({actor: game.actors.getName(player)})
		}, {
			chatBubble: true
		});

		this.ws.send(JSON.stringify({
			type:    "player_message",
			player,
			profile,
			message,
			userId
		}));
	}

	openDialog(profile, player = game.user.name, userId = game.user.id) {
		const existing = Object.values(ui.windows).find(w => w.id === "npc-agent-dialog");
		if (existing) {
			// If it's the same profile, just bring it forward
			if (existing.profile === profile) {
				existing.bringToTop();
				return;
			}
			// Different NPC — close the old one and open fresh
			existing.close();
		}
		new NPCAgentDialog(profile, player, userId).render(true);
	}
}

function resolveAutoSpeaker() {
    const setting = game.settings.get(MODULE_ID, "speakerAutoSelect");

    if (setting === "primary" && !game.user.isGM) {
        // Try primary character first
        const primary = game.user.character;
        if (primary) {
            return canvas.tokens.objects.children.find(
                t => t.actor?.id === primary.id && t.actor?.isOwner
            ) ?? null;
        }
        // Fall back to sole owned actor
        const owned = canvas.tokens.objects.children.filter(t => t.actor?.isOwner && !t.actor?.hasPlayerOwner === false);
        return owned.length === 1 ? owned[0] : null;
    }

    if (setting === "selected") {
        const selected = canvas.tokens.controlled.filter(t => t.actor?.isOwner);
        return selected.length === 1 ? selected[0] : null;
    }

    return null;
}

function resolveAutoTarget() {
    const setting = game.settings.get(MODULE_ID, "targetAutoSelect");

    if (setting === "targeted") {
        const targets = Array.from(game.user.targets);
        return targets.length === 1 ? targets[0] : null;
    }

    return null;
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
	
	game.settings.register(MODULE_ID, "speakerAutoSelect", {
		name:    "Speaker Auto Select",
		hint:    "Automatically determine your speaker token when using the Talk to NPC tool.",
		scope:   "client",
		config:  true,
		type:    String,
		default: "never",
		choices: {
			never:    "Never — always select manually",
			primary:  "Primary Character",
			selected: "Current Selected Token"
		}
	});

	game.settings.register(MODULE_ID, "targetAutoSelect", {
		name:    "Speak To Auto Select",
		hint:    "Automatically determine the target NPC when using the Talk to NPC tool.",
		scope:   "client",
		config:  true,
		type:    String,
		default: "never",
		choices: {
			never:    "Never — always select manually",
			targeted: "Current Target"
		}
	});
});

// ── Ready ──
Hooks.once("ready", () => {
	game.socket.on(SOCKET_ID, (data) => {
		if (game.user.isGM) {
			game.npcAgent.sendMessage(data.player, data.profile, data.message, data.userId);
		}
	});

    game.npcAgent = new NPCAgent();

    if (game.user.isGM) {
        game.npcAgent.connect();
    }
});

Hooks.on("getSceneControlButtons", (controls) => {
    const tokenControls = controls.find(c => c.name === "token");
    if (!tokenControls) return;

    tokenControls.tools.push({
        name:  "speak",
        title: "Talk to NPC",
        icon:  "fas fa-comment",
        toggle: true,
        active: false,
		onClick: (active) => {
			if (!active) {
				canvas.tokens._npcSpeakState  = null;
				canvas.tokens._npcSpeaker     = null;
				canvas.tokens._npcAutoTarget  = null;
				return;
			}

			const autoSpeaker = resolveAutoSpeaker();
			const autoTarget  = resolveAutoTarget();

			if (autoSpeaker && autoTarget) {
				// Both resolved — open dialog immediately and deactivate
				canvas.tokens._npcSpeakState = null;
				canvas.tokens.activate();
				ui.controls.initialize({ tool: "select" });
				game.npcAgent.openDialog(autoTarget.actor.name, autoSpeaker.actor.name, game.user.id);
				return;
			}

			if (autoSpeaker) {
				// Speaker resolved — skip to target selection
				autoSpeaker.control({ releaseOthers: true });
				canvas.tokens._npcSpeaker    = autoSpeaker;
				canvas.tokens._npcSpeakState = "target";
				canvas.tokens._npcAutoTarget = null;
				ui.notifications.info("Talk to NPC: Now click the NPC you want to speak to.");
				return;
			}

			if (autoTarget) {
				// Target resolved — still need speaker, store target for later
				canvas.tokens._npcSpeakState = "speaker";
				canvas.tokens._npcAutoTarget = autoTarget;
				ui.notifications.info("Talk to NPC: Click your character token to set your speaker.");
				return;
			}

			// Nothing resolved — full manual flow
			canvas.tokens._npcSpeakState = "speaker";
			canvas.tokens._npcAutoTarget = null;
			ui.notifications.info("Talk to NPC: Click your character token to set your speaker.");
		}
    });
});

Hooks.on("controlTool", (tool) => {
    if (tool !== "speak") {
        canvas.tokens._npcSpeakState = null;
        canvas.tokens._npcSpeaker    = null;
    }
});

Hooks.on("canvasReady", () => {
    canvas.tokens.objects.children.forEach(token => {
		token.on("pointerdown", () => {
			const state = canvas.tokens._npcSpeakState;
			if (!state) return;

			if (state === "speaker") {
				if (!token.actor?.isOwner) {
					ui.notifications.warn("Talk to NPC: You can only speak as a token you own.");
					return;
				}

				token.control({ releaseOthers: true });
				canvas.tokens._npcSpeaker    = token;

				// Check if target was already auto-resolved
				const autoTarget = canvas.tokens._npcAutoTarget;
				if (autoTarget) {
					canvas.tokens._npcSpeakState = null;
					canvas.tokens._npcAutoTarget = null;
					canvas.tokens.activate();
					ui.controls.initialize({ tool: "select" });
					game.user.updateTokenTargets([autoTarget.id]);
					game.npcAgent.openDialog(autoTarget.actor.name, token.actor.name, game.user.id);
					return;
				}

				canvas.tokens._npcSpeakState = "target";
				ui.notifications.info("Talk to NPC: Now click the NPC you want to speak to.");

			} else if (state === "target") {
				const speaker = canvas.tokens._npcSpeaker;
				if (!speaker) return;

				game.user.updateTokenTargets([token.id]);

				canvas.tokens._npcSpeakState = null;
				canvas.tokens._npcSpeaker    = null;
				canvas.tokens._npcAutoTarget = null;
				canvas.tokens.activate();
				ui.controls.initialize({ tool: "select" });

				const profile = token.actor?.name;
				if (!profile) {
					ui.notifications.warn("Talk to NPC: That token has no actor.");
					return;
				}

				game.npcAgent.openDialog(profile, speaker.actor.name, game.user.id);
			}
		});
    });
});