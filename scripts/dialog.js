import { MODULE_ID, SOCKET_ID } from "./constants.js";
	
export class NPCAgentDialog extends Application {
	constructor(profile, player = game.user.name, userId = game.user.id, options = {}) {
		super(options);
		this.profile = profile;
		this.player  = player;
		this.userId  = userId;

        // Speech state
        this._listening       = false;
        this._recognition     = null;
        this._accumulatedText = "";
        this._interimText     = "";
        this._committed       = false;
        this._pauseTimer      = null;
        this._silenceStart    = null;
        this._periodInserted  = false;
        this._stopTimeout     = null;
    }

	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			id:       "npc-agent-dialog",
			width:    400,
			height:   "auto",
			resizable: false
		});
	}

	get title() {
		return `${this.player} speaking with ${this.profile}`;
	}

    // ── Helpers ──

    _hasSpeech() {
        return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    }

    _capitalize(str) {
        if (!str) return str;
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    _applyCapitalization(text) {
        return text
            .split("\n\n")
            .map(para =>
                para.split(". ")
                    .map(s => this._capitalize(s.trim()))
                    .join(". ")
            )
            .join("\n\n");
    }

    _appendToAccumulated(text) {
        if (!text) return;
        if (this._accumulatedText.endsWith("\n\n")) {
            this._accumulatedText = this._accumulatedText + text.trim();
        } else if (this._accumulatedText.trimEnd()) {
            this._accumulatedText = `${this._accumulatedText.trimEnd()} ${text.trim()}`;
        } else {
            this._accumulatedText = text.trim();
        }
    }

    _addFinalPeriod() {
        if (this._accumulatedText
            && !this._accumulatedText.trimEnd().endsWith(".")
            && !this._accumulatedText.trimEnd().endsWith("?")
            && !this._accumulatedText.trimEnd().endsWith("!")
            && !this._accumulatedText.endsWith("\n\n")) {
            this._accumulatedText = this._accumulatedText.trimEnd() + ".";
        }
    }

    _commitToTextarea(textarea) {
        if (this._committed) return;
        this._committed = true;
        this._addFinalPeriod();
        if (this._accumulatedText) {
            textarea.value = this._applyCapitalization(this._accumulatedText);
        }
    }

    _setStatus(statusDot, state) {
        const states = {
            ready:     { bg: "#27ae60", shadow: "#27ae60" },
            listening: { bg: "#c0392b", shadow: "#c0392b" },
            cooldown:  { bg: "#f39c12", shadow: "#f39c12" }
        };
        const s = states[state];
        statusDot.style.background = s.bg;
        statusDot.style.boxShadow  = `0 0 5px ${s.shadow}`;
    }

    // ── Pause timer ──

    _clearPauseTimer() {
        if (this._pauseTimer) {
            clearTimeout(this._pauseTimer);
            this._pauseTimer = null;
        }
    }

    _schedulePauseCheck(textarea) {
        this._clearPauseTimer();
        this._silenceStart   = Date.now();
        this._periodInserted = false;

        const shortPauseMs = game.settings.get(MODULE_ID, "shortPauseMs");
        const longPauseMs  = game.settings.get(MODULE_ID, "longPauseMs");

        this._pauseTimer = setTimeout(() => {
            if (!this._periodInserted
                && this._accumulatedText
                && !this._accumulatedText.trimEnd().endsWith(".")
                && !this._accumulatedText.endsWith("\n\n")) {
                this._accumulatedText = this._accumulatedText.trimEnd() + ".  ";
                this._periodInserted  = true;
                if (!this._committed) textarea.value = this._applyCapitalization(this._accumulatedText);
            }

            const remaining = longPauseMs - (Date.now() - this._silenceStart);
            this._pauseTimer = setTimeout(() => {
                if (this._accumulatedText && !this._accumulatedText.endsWith("\n\n")) {
                    this._accumulatedText = this._accumulatedText.trimEnd()
                        .replace(/\.\s*$/, "") + ".\n\n";
                    this._periodInserted = false;
                    if (!this._committed) textarea.value = this._applyCapitalization(this._accumulatedText);
                }
                this._pauseTimer = null;
            }, Math.max(remaining, 0));
        }, shortPauseMs);
    }

    // ── Speech recognition ──

    _buildRecognition(textarea) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const r           = new SpeechRecognition();
        r.lang            = "en-US";
        r.interimResults  = true;
        r.continuous      = true;
        r.maxAlternatives = 1;

        r.onresult = (event) => {
            if (this._committed) return;

            this._interimText = "";
            let newFinal = "";

            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    newFinal += event.results[i][0].transcript;
                } else {
                    this._interimText += event.results[i][0].transcript;
                }
            }

            if (newFinal) {
                this._appendToAccumulated(newFinal);
                this._interimText = "";
            }

            textarea.value = this._applyCapitalization(this._accumulatedText);

            if (this._interimText) {
                this._periodInserted = false;
                this._schedulePauseCheck(textarea);
            }
        };

        r.onerror = (event) => {
            if (event.error === "no-speech" || event.error === "aborted") return;
            console.error(`${MODULE_ID} | Speech error: ${event.error}`);
        };

        r.onend = () => {
            if (this._listening) {
                if (this._interimText && !this._committed) {
                    this._appendToAccumulated(this._interimText);
                    this._interimText  = "";
                    textarea.value = this._applyCapitalization(this._accumulatedText);
                }
                this._recognition = this._buildRecognition(textarea);
                this._recognition.start();
            } else {
                this._recognition = null;
                if (!this._committed) this._commitToTextarea(textarea);
            }
        };

        return r;
    }

    // ── PTT controls ──

    _startListening(textarea, pttBtn, statusDot) {
        if (this._stopTimeout) {
            clearTimeout(this._stopTimeout);
            this._stopTimeout = null;
        }
        if (this._listening) return;

        this._listening       = true;
        this._committed       = false;
        this._accumulatedText = textarea.value.trim();
        this._interimText     = "";
        this._periodInserted  = false;
        this._setStatus(statusDot, "listening");
        this._recognition = this._buildRecognition(textarea);
        this._recognition.start();
    }

    _stopListening(textarea, pttBtn, statusDot) {
        if (!this._listening) return;

        this._stopTimeout = setTimeout(() => {
            if (!this._listening) return;
            this._listening = false;
            this._clearPauseTimer();

            if (this._interimText) {
                this._appendToAccumulated(this._interimText);
                this._interimText = "";
            }

            this._commitToTextarea(textarea);

            if (this._recognition) this._recognition.stop();

            this._accumulatedText = "";
            pttBtn.disabled = true;
            this._setStatus(statusDot, "cooldown");

            setTimeout(() => {
                pttBtn.disabled = false;
                this._setStatus(statusDot, "ready");
            }, 1000);
        }, 400);
    }

    // ── Render ──

    async _renderInner() {
        const hasSpeech = this._hasSpeech();

        const $html = $(`
            <div style="display:flex; flex-direction:column; gap:8px; padding:4px 0;">
                <label>Message</label>
                <textarea id="npc-message" rows="4"
                    style="width:100%; resize:vertical;"
                    placeholder="Type or use push-to-talk..."></textarea>
                ${hasSpeech ? `
                <div style="display:flex; align-items:center; gap:10px;">
                    <button id="npc-ptt" type="button"
                        style="padding:6px 14px; cursor:pointer;">
                        🎤 Hold to Talk
                    </button>
                    <div id="npc-status" style="
                        width: 12px; height: 12px;
                        border-radius: 50%;
                        background: #27ae60;
                        box-shadow: 0 0 5px #27ae60;
                        transition: background 0.2s, box-shadow 0.2s;
                        flex-shrink: 0;
                    "></div>
                </div>` : ""}
                <div style="display:flex; gap:8px; margin-top:4px;">
                    <button id="npc-send">Send</button>
                    <button id="npc-cancel">Cancel</button>
                </div>
            </div>
        `);

        const textarea  = $html.find("#npc-message")[0];
        const sendBtn   = $html.find("#npc-send")[0];
        const cancelBtn = $html.find("#npc-cancel")[0];

        sendBtn.addEventListener("click", () => {
            const message = textarea.value.trim();
            if (!message) {
                ui.notifications.warn("Please enter a message.");
                return;
            }
			if (game.user.isGM) {
				game.npcAgent.sendMessage(this.player, this.profile, message, this.userId);
			} else {
				game.socket.emit(SOCKET_ID, {
					player:  this.player,
					profile: this.profile,
					message,
					userId:  this.userId
				});
			}
            ui.notifications.info("Message sent. Waiting for response...");
            this.close();
        });

        cancelBtn.addEventListener("click", () => this.close());

        if (hasSpeech) {
            const pttBtn    = $html.find("#npc-ptt")[0];
            const statusDot = $html.find("#npc-status")[0];

            pttBtn.addEventListener("mousedown",  (e) => { e.preventDefault(); this._startListening(textarea, pttBtn, statusDot); });
            pttBtn.addEventListener("mouseup",    ()  => this._stopListening(textarea, pttBtn, statusDot));
            pttBtn.addEventListener("mouseleave", ()  => { if (this._listening) this._stopListening(textarea, pttBtn, statusDot); });
            pttBtn.addEventListener("touchstart", (e) => { e.preventDefault(); this._startListening(textarea, pttBtn, statusDot); });
            pttBtn.addEventListener("touchend",   (e) => { e.preventDefault(); this._stopListening(textarea, pttBtn, statusDot); });
        }

        return $html;
    }

    // ── Cleanup ──

    async close(options = {}) {
        if (this._recognition) {
            this._listening = false;
            this._recognition.stop();
            this._recognition = null;
        }
        this._clearPauseTimer();
        return super.close(options);
    }
}
