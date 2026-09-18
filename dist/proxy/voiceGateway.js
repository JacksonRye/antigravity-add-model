"use strict";
/**
 * Real-time Bidirectional Voice Gateway for Antigravity.
 * Proxies local WebSocket connections to Google Multimodal Live API (BidiGenerateContent).
 * Supports PCM 16-bit 24kHz bidirectional streaming with barge-in interruption.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoiceGateway = void 0;
exports.attachVoiceGateway = attachVoiceGateway;
const ws_1 = require("ws");
const electron_log_1 = __importDefault(require("electron-log"));
const GEMINI_LIVE_HOST = 'generativelanguage.googleapis.com';
const GEMINI_LIVE_PATH = '/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent';
const DEFAULT_MODEL = 'models/gemini-2.0-flash-exp';
const DEFAULT_VOICE = 'Puck';
class VoiceGateway {
    constructor(options) {
        this.getApiKey = options.getApiKey;
        this.defaultVoice = options.defaultVoice || DEFAULT_VOICE;
        this.defaultModel = options.defaultModel || DEFAULT_MODEL;
        this.systemInstruction =
            options.systemInstruction ||
                'You are Antigravity\'s real-time AI pair programmer. You are sharp, concise, friendly, and speak naturally. Provide quick, accurate, conversational answers suitable for spoken audio without markdown tables or code formatting.';
        this.wss = new ws_1.WebSocketServer({ noServer: true });
        this.setupWss();
    }
    handleUpgrade(req, socket, head) {
        const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
        if (url.pathname === '/ws/live' || url.pathname === '/voice/live') {
            this.wss.handleUpgrade(req, socket, head, (ws) => {
                this.wss.emit('connection', ws, req);
            });
            return true;
        }
        return false;
    }
    close() {
        try {
            this.wss.clients.forEach((client) => {
                try {
                    client.terminate();
                }
                catch (_) { }
            });
            this.wss.close();
        }
        catch (e) {
            electron_log_1.default.error('[VoiceGateway] Error closing WebSocket server:', e);
        }
    }
    setupWss() {
        this.wss.on('connection', (clientWs, req) => {
            electron_log_1.default.info('[VoiceGateway] New client connection from', req.socket.remoteAddress);
            const apiKey = this.getApiKey();
            if (!apiKey) {
                electron_log_1.default.warn('[VoiceGateway] Connection rejected: No Google API key configured.');
                clientWs.send(JSON.stringify({
                    type: 'error',
                    error: 'No Google API key configured in custom models or environment.',
                }));
                clientWs.close(1008, 'API Key Missing');
                return;
            }
            let upstreamWs = null;
            let upstreamReady = false;
            const pendingAudioQueue = [];
            const upstreamUrl = `wss://${GEMINI_LIVE_HOST}${GEMINI_LIVE_PATH}?key=${encodeURIComponent(apiKey)}`;
            try {
                upstreamWs = new ws_1.WebSocket(upstreamUrl);
            }
            catch (err) {
                electron_log_1.default.error('[VoiceGateway] Failed to instantiate upstream WebSocket:', err);
                clientWs.send(JSON.stringify({ type: 'error', error: err.message || 'Connection failed' }));
                clientWs.close(1011, 'Upstream Error');
                return;
            }
            // ─── Upstream Event Handlers ──────────────────────────────────────────
            upstreamWs.on('open', () => {
                electron_log_1.default.info('[VoiceGateway] Connected to Gemini Multimodal Live API upstream.');
                // Send Initial Setup Handshake
                const setupMessage = {
                    setup: {
                        model: this.defaultModel,
                        generationConfig: {
                            responseModalities: ['AUDIO'],
                            speechConfig: {
                                voiceConfig: {
                                    prebuiltVoiceConfig: {
                                        voiceName: this.defaultVoice,
                                    },
                                },
                            },
                        },
                        systemInstruction: {
                            parts: [{ text: this.systemInstruction }],
                        },
                    },
                };
                upstreamWs?.send(JSON.stringify(setupMessage));
            });
            upstreamWs.on('message', (data) => {
                try {
                    const str = typeof data === 'string' ? data : data.toString('utf-8');
                    const parsed = JSON.parse(str);
                    // Handle Setup Complete
                    if (parsed.setupComplete) {
                        electron_log_1.default.info('[VoiceGateway] Upstream setup complete. Ready for audio streaming.');
                        upstreamReady = true;
                        // Flush any buffered audio chunks
                        while (pendingAudioQueue.length > 0) {
                            const chunk = pendingAudioQueue.shift();
                            if (chunk && upstreamWs?.readyState === ws_1.WebSocket.OPEN) {
                                this.sendAudioChunkToUpstream(upstreamWs, chunk);
                            }
                        }
                        clientWs.send(JSON.stringify({ type: 'ready', model: this.defaultModel, voice: this.defaultVoice }));
                        return;
                    }
                    // Handle Server Content (Spoken audio & turns)
                    if (parsed.serverContent) {
                        const sc = parsed.serverContent;
                        // Barge-in Interruption Signal from Gemini
                        if (sc.interrupted) {
                            electron_log_1.default.info('[VoiceGateway] Model speech interrupted by user barge-in.');
                            clientWs.send(JSON.stringify({ type: 'interrupted' }));
                        }
                        // Extract Audio and/or Text parts
                        if (sc.modelTurn && Array.isArray(sc.modelTurn.parts)) {
                            for (const part of sc.modelTurn.parts) {
                                if (part.inlineData && part.inlineData.data) {
                                    // Forward base64 PCM audio to client
                                    clientWs.send(JSON.stringify({
                                        type: 'audio',
                                        data: part.inlineData.data,
                                        mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000',
                                    }));
                                }
                                if (part.text) {
                                    clientWs.send(JSON.stringify({ type: 'text', text: part.text }));
                                }
                            }
                        }
                        if (sc.turnComplete) {
                            clientWs.send(JSON.stringify({ type: 'turn_complete' }));
                        }
                    }
                }
                catch (err) {
                    electron_log_1.default.error('[VoiceGateway] Error parsing upstream message:', err);
                }
            });
            upstreamWs.on('error', (err) => {
                electron_log_1.default.error('[VoiceGateway] Upstream WebSocket error:', err);
                if (clientWs.readyState === clientWs.OPEN) {
                    clientWs.send(JSON.stringify({ type: 'error', error: err.message || 'Upstream error' }));
                }
            });
            upstreamWs.on('close', (code, reason) => {
                electron_log_1.default.info(`[VoiceGateway] Upstream closed with code ${code}: ${reason.toString()}`);
                if (clientWs.readyState === clientWs.OPEN) {
                    clientWs.send(JSON.stringify({ type: 'closed', code, reason: reason.toString() }));
                    clientWs.close(code, reason.toString());
                }
            });
            // ─── Client Event Handlers ────────────────────────────────────────────
            clientWs.on('message', (message, isBinary) => {
                try {
                    if (isBinary || Buffer.isBuffer(message)) {
                        // Raw PCM 16-bit buffer from client microphone
                        const buf = Buffer.isBuffer(message) ? message : Buffer.from(message);
                        if (!upstreamReady || upstreamWs?.readyState !== ws_1.WebSocket.OPEN) {
                            // Buffer limited chunks while waiting for setupComplete
                            if (pendingAudioQueue.length < 25) {
                                pendingAudioQueue.push(buf);
                            }
                            return;
                        }
                        this.sendAudioChunkToUpstream(upstreamWs, buf);
                    }
                    else {
                        const str = message.toString('utf-8');
                        const parsed = JSON.parse(str);
                        if (parsed.type === 'audio' && parsed.data) {
                            // Base64 audio chunk from client
                            const buf = Buffer.from(parsed.data, 'base64');
                            if (!upstreamReady || upstreamWs?.readyState !== ws_1.WebSocket.OPEN) {
                                if (pendingAudioQueue.length < 25)
                                    pendingAudioQueue.push(buf);
                                return;
                            }
                            this.sendAudioChunkToUpstream(upstreamWs, buf);
                        }
                        else if (parsed.type === 'text' && parsed.text) {
                            // Client sent text into the live voice session
                            if (upstreamWs?.readyState === ws_1.WebSocket.OPEN) {
                                upstreamWs.send(JSON.stringify({
                                    clientContent: {
                                        turns: [
                                            {
                                                role: 'user',
                                                parts: [{ text: parsed.text }],
                                            },
                                        ],
                                        turnComplete: true,
                                    },
                                }));
                            }
                        }
                        else if (parsed.type === 'interrupt') {
                            electron_log_1.default.info('[VoiceGateway] Client requested interrupt.');
                        }
                    }
                }
                catch (err) {
                    electron_log_1.default.error('[VoiceGateway] Error handling client message:', err);
                }
            });
            clientWs.on('error', (err) => {
                electron_log_1.default.warn('[VoiceGateway] Client WebSocket error:', err);
                if (upstreamWs && upstreamWs.readyState === ws_1.WebSocket.OPEN) {
                    upstreamWs.close(1000, 'Client error');
                }
            });
            clientWs.on('close', () => {
                electron_log_1.default.info('[VoiceGateway] Client disconnected.');
                if (upstreamWs && upstreamWs.readyState === ws_1.WebSocket.OPEN) {
                    upstreamWs.close(1000, 'Client disconnected');
                }
            });
        });
    }
    sendAudioChunkToUpstream(ws, pcmBuffer) {
        const message = {
            realtimeInput: {
                mediaChunks: [
                    {
                        mimeType: 'audio/pcm;rate=24000',
                        data: pcmBuffer.toString('base64'),
                    },
                ],
            },
        };
        ws.send(JSON.stringify(message));
    }
}
exports.VoiceGateway = VoiceGateway;
function attachVoiceGateway(server, getApiKey, options) {
    const gateway = new VoiceGateway({
        getApiKey,
        ...options,
    });
    server.on('upgrade', (req, socket, head) => {
        gateway.handleUpgrade(req, socket, head);
    });
    return gateway;
}
//# sourceMappingURL=voiceGateway.js.map