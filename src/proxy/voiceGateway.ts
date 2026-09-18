/**
 * Real-time Bidirectional Voice Gateway for Antigravity.
 * Proxies local WebSocket connections to Google Multimodal Live API (BidiGenerateContent).
 * Supports PCM 16-bit 24kHz bidirectional streaming with barge-in interruption.
 * Built with zero external dependencies using Node.js native sockets & Node 22 WebSocket.
 */

import * as http from 'http';
import * as net from 'net';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import log from 'electron-log';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const GEMINI_LIVE_HOST = 'generativelanguage.googleapis.com';
const GEMINI_LIVE_PATH = '/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent';
const DEFAULT_MODEL = 'models/gemini-2.0-flash-exp';
const DEFAULT_VOICE = 'Puck';

function getVoiceConfigPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return path.join(home, '.gemini', 'antigravity', 'voice_config.json');
}

export function loadVoiceConfig(): { apiKey?: string; voice?: string; model?: string } {
  try {
    const p = getVoiceConfigPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  } catch (_) {}
  return {};
}

export function saveVoiceConfig(config: { apiKey?: string; voice?: string; model?: string }): void {
  try {
    const p = getVoiceConfigPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const existing = loadVoiceConfig();
    fs.writeFileSync(p, JSON.stringify({ ...existing, ...config }, null, 2), 'utf-8');
  } catch (err) {
    log.error('[VoiceGateway] Failed to save voice config:', err);
  }
}

export interface VoiceGatewayOptions {
  getApiKey: () => string | null;
  defaultVoice?: string;
  defaultModel?: string;
  systemInstruction?: string;
}

/**
 * Lightweight RFC-6455 WebSocket connection over a raw net.Socket.
 */
class LocalWsConnection extends EventEmitter {
  public socket: net.Socket;
  public readyState: number = 1; // 1 = OPEN
  private buffer: Buffer = Buffer.alloc(0);

  constructor(socket: net.Socket) {
    super();
    this.socket = socket;

    this.socket.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.parseFrames();
    });

    this.socket.on('error', (err) => {
      this.readyState = 3;
      this.emit('error', err);
    });

    this.socket.on('close', () => {
      this.readyState = 3;
      this.emit('close');
    });
  }

  public send(data: string | Buffer): void {
    if (this.readyState !== 1 || this.socket.destroyed) return;
    const isBinary = Buffer.isBuffer(data);
    const frame = encodeFrame(data, isBinary);
    this.socket.write(frame);
  }

  public close(code: number = 1000, reason: string = ''): void {
    if (this.readyState === 3) return;
    this.readyState = 2; // CLOSING
    try {
      const reasonBuf = Buffer.from(reason, 'utf-8');
      const payload = Buffer.alloc(2 + reasonBuf.length);
      payload.writeUInt16BE(code, 0);
      reasonBuf.copy(payload, 2);
      this.socket.write(encodeFrame(payload, true, 0x08));
    } catch (_) {}
    this.socket.end();
    this.readyState = 3;
  }

  private parseFrames(): void {
    while (this.buffer.length >= 2) {
      const firstByte = this.buffer[0];
      const secondByte = this.buffer[1];

      const opcode = firstByte & 0x0f;
      const isMasked = (secondByte & 0x80) === 0x80;
      let payloadLen = secondByte & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (this.buffer.length < 4) return;
        payloadLen = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (this.buffer.length < 10) return;
        payloadLen = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }

      let maskKey: Buffer | null = null;
      if (isMasked) {
        if (this.buffer.length < offset + 4) return;
        maskKey = this.buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      if (this.buffer.length < offset + payloadLen) return;

      const payload = Buffer.from(this.buffer.subarray(offset, offset + payloadLen));
      this.buffer = this.buffer.subarray(offset + payloadLen);

      // Unmask client payload
      if (maskKey) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= maskKey[i % 4];
        }
      }

      // Handle Opcodes
      if (opcode === 0x08) {
        // Close frame
        this.emit('close');
        this.close();
        return;
      } else if (opcode === 0x09) {
        // Ping -> Reply Pong
        this.socket.write(encodeFrame(payload, true, 0x0a));
      } else if (opcode === 0x01) {
        // Text frame
        this.emit('message', payload.toString('utf-8'), false);
      } else if (opcode === 0x02) {
        // Binary frame
        this.emit('message', payload, true);
      }
    }
  }
}

function encodeFrame(data: Buffer | string, isBinary: boolean, customOpcode?: number): Buffer {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8');
  const len = payload.length;
  const opcode = customOpcode !== undefined ? customOpcode : isBinary ? 0x02 : 0x01;
  const firstByte = 0x80 | opcode; // FIN = 1

  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = firstByte;
    header[1] = len;
  } else if (len <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = firstByte;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = firstByte;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payload]);
}

export class VoiceGateway {
  private getApiKey: () => string | null;
  private defaultVoice: string;
  private defaultModel: string;
  private systemInstruction: string;
  private activeClients: Set<LocalWsConnection> = new Set();

  constructor(options: VoiceGatewayOptions) {
    this.getApiKey = options.getApiKey;
    this.defaultVoice = options.defaultVoice || DEFAULT_VOICE;
    this.defaultModel = options.defaultModel || DEFAULT_MODEL;
    this.systemInstruction =
      options.systemInstruction ||
      'You are Antigravity\'s real-time AI pair programmer. You are sharp, concise, friendly, and speak naturally. Provide quick, accurate, conversational answers suitable for spoken audio without markdown tables or code formatting.';
  }

  public handleUpgrade(req: http.IncomingMessage, socket: net.Socket, _head: Buffer): boolean {
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname !== '/ws/live' && url.pathname !== '/voice/live') {
      return false;
    }

    const clientKey = req.headers['sec-websocket-key'];
    if (!clientKey) {
      socket.destroy();
      return true;
    }

    const acceptKey = crypto
      .createHash('sha1')
      .update(clientKey + WS_GUID)
      .digest('base64');

    const responseHeaders = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '\r\n',
    ];

    socket.write(responseHeaders.join('\r\n'));

    const clientWs = new LocalWsConnection(socket);
    this.activeClients.add(clientWs);

    clientWs.on('close', () => {
      this.activeClients.delete(clientWs);
    });

    const customKey = url.searchParams.get('key');
    this.handleClientSession(clientWs, customKey || undefined);
    return true;
  }

  public close(): void {
    for (const client of this.activeClients) {
      try {
        client.close(1000, 'Server stopping');
      } catch (_) {}
    }
    this.activeClients.clear();
  }

  private handleClientSession(clientWs: LocalWsConnection, explicitKey?: string): void {
    const voiceCfg = loadVoiceConfig();
    const apiKey = explicitKey || voiceCfg.apiKey || this.getApiKey();
    if (!apiKey) {
      log.warn('[VoiceGateway] Connection rejected: No Google API key configured.');
      clientWs.send(
        JSON.stringify({
          type: 'error',
          code: 1008,
          error: 'No Google API key configured. Please enter your Google AI Studio API key (starts with AIzaSy) in the Live Voice Console.',
        }),
      );
      clientWs.close(1008, 'API Key Missing');
      return;
    }

    const upstreamUrl = `wss://${GEMINI_LIVE_HOST}${GEMINI_LIVE_PATH}?key=${encodeURIComponent(apiKey)}`;
    let upstreamWs: WebSocket | null = null;
    let upstreamReady = false;
    const pendingAudioQueue: Buffer[] = [];

    try {
      upstreamWs = new (globalThis as any).WebSocket(upstreamUrl);
    } catch (err: any) {
      log.error('[VoiceGateway] Failed to instantiate upstream WebSocket:', err);
      clientWs.send(JSON.stringify({ type: 'error', error: err.message || 'Connection failed' }));
      clientWs.close(1011, 'Upstream Error');
      return;
    }

    // ─── Upstream Handlers ──────────────────────────────────────────────────

    upstreamWs.onopen = () => {
      log.info('[VoiceGateway] Connected to Gemini Multimodal Live API upstream.');

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
    };

    upstreamWs.onmessage = (event: any) => {
      try {
        const raw = typeof event.data === 'string' ? event.data : event.data.toString('utf-8');
        const parsed = JSON.parse(raw);

        if (parsed.setupComplete) {
          log.info('[VoiceGateway] Upstream setup complete. Ready for audio streaming.');
          upstreamReady = true;

          while (pendingAudioQueue.length > 0) {
            const chunk = pendingAudioQueue.shift();
            if (chunk && upstreamWs?.readyState === (globalThis as any).WebSocket.OPEN) {
              this.sendAudioChunkToUpstream(upstreamWs, chunk);
            }
          }

          clientWs.send(
            JSON.stringify({
              type: 'ready',
              model: this.defaultModel,
              voice: this.defaultVoice,
            }),
          );
          return;
        }

        if (parsed.serverContent) {
          const sc = parsed.serverContent;

          if (sc.interrupted) {
            log.info('[VoiceGateway] Model speech interrupted by barge-in.');
            clientWs.send(JSON.stringify({ type: 'interrupted' }));
          }

          if (sc.modelTurn && Array.isArray(sc.modelTurn.parts)) {
            for (const part of sc.modelTurn.parts) {
              if (part.inlineData && part.inlineData.data) {
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
    };

    upstreamWs.onerror = (err: any) => {
      log.error('[VoiceGateway] Upstream WebSocket error:', err);
      if (clientWs.readyState === 1) {
        clientWs.send(JSON.stringify({ type: 'error', error: err?.message || 'Upstream connection error' }));
      }
    };

    upstreamWs.onclose = (event: any) => {
      const code = event?.code || 1000;
      const rawReason = (event?.reason || '').toString();
      log.warn(`[VoiceGateway] Upstream closed: code=${code}, reason="${rawReason}"`);

      let friendlyError = rawReason || `Upstream closed with code ${code}`;
      if (code === 1008) {
        friendlyError = `Google Live API Blocked (1008): "${rawReason}". Cause: Your Google API key is restricted or Generative Language API is disabled. Please verify your Google AI Studio API key.`;
      }

      if (clientWs.readyState === 1) {
        clientWs.send(
          JSON.stringify({
            type: 'error',
            code,
            error: friendlyError,
            rawReason,
          }),
        );
        clientWs.close(code, rawReason);
      }
    };

    // ─── Client Handlers ────────────────────────────────────────────────────

    clientWs.on('message', (message: string | Buffer, isBinary: boolean) => {
      try {
        if (isBinary || Buffer.isBuffer(message)) {
          const buf = Buffer.isBuffer(message) ? message : Buffer.from(message);
          if (!upstreamReady || upstreamWs?.readyState !== (globalThis as any).WebSocket.OPEN) {
            if (pendingAudioQueue.length < 25) pendingAudioQueue.push(buf);
            return;
          }
          this.sendAudioChunkToUpstream(upstreamWs, buf);
        } else {
          const parsed = JSON.parse(message.toString());
          if (parsed.type === 'ping') {
            clientWs.send(
              JSON.stringify({
                type: 'pong',
                timestamp: Date.now(),
                hasApiKey: Boolean(apiKey),
                upstreamReady,
                upstreamState: upstreamWs ? (upstreamWs as any).readyState : -1,
              }),
            );
          } else if (parsed.type === 'audio' && parsed.data) {
            const buf = Buffer.from(parsed.data, 'base64');
            if (!upstreamReady || upstreamWs?.readyState !== (globalThis as any).WebSocket.OPEN) {
              if (pendingAudioQueue.length < 25) pendingAudioQueue.push(buf);
              return;
            }
            this.sendAudioChunkToUpstream(upstreamWs, buf);
          } else if (parsed.type === 'text' && parsed.text) {
            if (upstreamWs?.readyState === (globalThis as any).WebSocket.OPEN) {
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
          } else if (parsed.type === 'save_key' && parsed.apiKey) {
            saveVoiceConfig({ apiKey: parsed.apiKey.trim() });
            log.info('[VoiceGateway] Updated voice API key from client.');
            clientWs.send(JSON.stringify({ type: 'key_saved', success: true }));
          }
        }
      } catch (err) {
        log.error('[VoiceGateway] Error handling client message:', err);
      }
    });

    clientWs.on('close', () => {
      log.info('[VoiceGateway] Client disconnected.');
      if (upstreamWs && upstreamWs.readyState === (globalThis as any).WebSocket.OPEN) {
        upstreamWs.close(1000, 'Client disconnected');
      }
    });
  }

  private sendAudioChunkToUpstream(ws: WebSocket, pcmBuffer: Buffer): void {
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
    gateway.handleUpgrade(req, socket as net.Socket, head);
  });

  return gateway;
}
