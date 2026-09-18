/**
 * Real-time Bidirectional Voice Gateway for Antigravity.
 * Proxies local WebSocket connections to Google Multimodal Live API (BidiGenerateContent).
 * Supports PCM 16-bit 24kHz bidirectional streaming with barge-in interruption.
 */

import * as http from 'http';
import { WebSocketServer, WebSocket as WsClient } from 'ws';
import log from 'electron-log';

const GEMINI_LIVE_HOST = 'generativelanguage.googleapis.com';
const GEMINI_LIVE_PATH = '/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent';
const DEFAULT_MODEL = 'models/gemini-2.0-flash-exp';
const DEFAULT_VOICE = 'Puck';

export interface VoiceGatewayOptions {
  getApiKey: () => string | null;
  defaultVoice?: string;
  defaultModel?: string;
  systemInstruction?: string;
}

export class VoiceGateway {
  private wss: WebSocketServer;
  private getApiKey: () => string | null;
  private defaultVoice: string;
  private defaultModel: string;
  private systemInstruction: string;

  constructor(options: VoiceGatewayOptions) {
    this.getApiKey = options.getApiKey;
    this.defaultVoice = options.defaultVoice || DEFAULT_VOICE;
    this.defaultModel = options.defaultModel || DEFAULT_MODEL;
    this.systemInstruction =
      options.systemInstruction ||
      'You are Antigravity\'s real-time AI pair programmer. You are sharp, concise, friendly, and speak naturally. Provide quick, accurate, conversational answers suitable for spoken audio without markdown tables or code formatting.';

    this.wss = new WebSocketServer({ noServer: true });
    this.setupWss();
  }

  public handleUpgrade(req: http.IncomingMessage, socket: any, head: Buffer): boolean {
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/ws/live' || url.pathname === '/voice/live') {
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit('connection', ws, req);
      });
      return true;
    }
    return false;
  }

  public close(): void {
    try {
      this.wss.clients.forEach((client) => {
        try {
          client.terminate();
        } catch (_) {}
      });
      this.wss.close();
    } catch (e) {
      log.error('[VoiceGateway] Error closing WebSocket server:', e);
    }
  }

  private setupWss(): void {
    this.wss.on('connection', (clientWs, req) => {
      log.info('[VoiceGateway] New client connection from', req.socket.remoteAddress);

      const apiKey = this.getApiKey();
      if (!apiKey) {
        log.warn('[VoiceGateway] Connection rejected: No Google API key configured.');
        clientWs.send(
          JSON.stringify({
            type: 'error',
            error: 'No Google API key configured in custom models or environment.',
          }),
        );
        clientWs.close(1008, 'API Key Missing');
        return;
      }

      let upstreamWs: WsClient | null = null;
      let upstreamReady = false;
      const pendingAudioQueue: Buffer[] = [];

      const upstreamUrl = `wss://${GEMINI_LIVE_HOST}${GEMINI_LIVE_PATH}?key=${encodeURIComponent(apiKey)}`;

      try {
        upstreamWs = new WsClient(upstreamUrl);
      } catch (err: any) {
        log.error('[VoiceGateway] Failed to instantiate upstream WebSocket:', err);
        clientWs.send(JSON.stringify({ type: 'error', error: err.message || 'Connection failed' }));
        clientWs.close(1011, 'Upstream Error');
        return;
      }

      // ─── Upstream Event Handlers ──────────────────────────────────────────

      upstreamWs.on('open', () => {
        log.info('[VoiceGateway] Connected to Gemini Multimodal Live API upstream.');

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

      upstreamWs.on('message', (data: any) => {
        try {
          const str = typeof data === 'string' ? data : data.toString('utf-8');
          const parsed = JSON.parse(str);

          // Handle Setup Complete
          if (parsed.setupComplete) {
            log.info('[VoiceGateway] Upstream setup complete. Ready for audio streaming.');
            upstreamReady = true;

            // Flush any buffered audio chunks
            while (pendingAudioQueue.length > 0) {
              const chunk = pendingAudioQueue.shift();
              if (chunk && upstreamWs?.readyState === WsClient.OPEN) {
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
              log.info('[VoiceGateway] Model speech interrupted by user barge-in.');
              clientWs.send(JSON.stringify({ type: 'interrupted' }));
            }

            // Extract Audio and/or Text parts
            if (sc.modelTurn && Array.isArray(sc.modelTurn.parts)) {
              for (const part of sc.modelTurn.parts) {
                if (part.inlineData && part.inlineData.data) {
                  // Forward base64 PCM audio to client
                  clientWs.send(
                    JSON.stringify({
                      type: 'audio',
                      data: part.inlineData.data,
                      mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000',
                    }),
                  );
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
        } catch (err) {
          log.error('[VoiceGateway] Error parsing upstream message:', err);
        }
      });

      upstreamWs.on('error', (err) => {
        log.error('[VoiceGateway] Upstream WebSocket error:', err);
        if (clientWs.readyState === clientWs.OPEN) {
          clientWs.send(JSON.stringify({ type: 'error', error: err.message || 'Upstream error' }));
        }
      });

      upstreamWs.on('close', (code, reason) => {
        log.info(`[VoiceGateway] Upstream closed with code ${code}: ${reason.toString()}`);
        if (clientWs.readyState === clientWs.OPEN) {
          clientWs.send(JSON.stringify({ type: 'closed', code, reason: reason.toString() }));
          clientWs.close(code, reason.toString());
        }
      });

      // ─── Client Event Handlers ────────────────────────────────────────────

      clientWs.on('message', (message: any, isBinary: boolean) => {
        try {
          if (isBinary || Buffer.isBuffer(message)) {
            // Raw PCM 16-bit buffer from client microphone
            const buf = Buffer.isBuffer(message) ? message : Buffer.from(message);
            if (!upstreamReady || upstreamWs?.readyState !== WsClient.OPEN) {
              // Buffer limited chunks while waiting for setupComplete
              if (pendingAudioQueue.length < 25) {
                pendingAudioQueue.push(buf);
              }
              return;
            }
            this.sendAudioChunkToUpstream(upstreamWs, buf);
          } else {
            const str = message.toString('utf-8');
            const parsed = JSON.parse(str);

            if (parsed.type === 'audio' && parsed.data) {
              // Base64 audio chunk from client
              const buf = Buffer.from(parsed.data, 'base64');
              if (!upstreamReady || upstreamWs?.readyState !== WsClient.OPEN) {
                if (pendingAudioQueue.length < 25) pendingAudioQueue.push(buf);
                return;
              }
              this.sendAudioChunkToUpstream(upstreamWs, buf);
            } else if (parsed.type === 'text' && parsed.text) {
              // Client sent text into the live voice session
              if (upstreamWs?.readyState === WsClient.OPEN) {
                upstreamWs.send(
                  JSON.stringify({
                    clientContent: {
                      turns: [
                        {
                          role: 'user',
                          parts: [{ text: parsed.text }],
                        },
                      ],
                      turnComplete: true,
                    },
                  }),
                );
              }
            } else if (parsed.type === 'interrupt') {
              log.info('[VoiceGateway] Client requested interrupt.');
            }
          }
        } catch (err) {
          log.error('[VoiceGateway] Error handling client message:', err);
        }
      });

      clientWs.on('error', (err) => {
        log.warn('[VoiceGateway] Client WebSocket error:', err);
        if (upstreamWs && upstreamWs.readyState === WsClient.OPEN) {
          upstreamWs.close(1000, 'Client error');
        }
      });

      clientWs.on('close', () => {
        log.info('[VoiceGateway] Client disconnected.');
        if (upstreamWs && upstreamWs.readyState === WsClient.OPEN) {
          upstreamWs.close(1000, 'Client disconnected');
        }
      });
    });
  }

  private sendAudioChunkToUpstream(ws: WsClient, pcmBuffer: Buffer): void {
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

export function attachVoiceGateway(
  server: http.Server,
  getApiKey: () => string | null,
  options?: Partial<VoiceGatewayOptions>,
): VoiceGateway {
  const gateway = new VoiceGateway({
    getApiKey,
    ...options,
  });

  server.on('upgrade', (req, socket, head) => {
    gateway.handleUpgrade(req, socket, head);
  });

  return gateway;
}
