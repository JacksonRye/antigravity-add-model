/**
 * Real-time Bidirectional Voice Gateway for Antigravity.
 * Proxies local WebSocket connections strictly to Google Cloud Vertex AI (LlmBidiService / BidiGenerateContent).
 * Supports PCM 16-bit 24kHz bidirectional streaming with barge-in interruption.
 * Built with zero external dependencies using Node.js native HTTPS/TLS and RFC-6455 framing.
 */

import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as tls from 'tls';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import log from 'electron-log';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const DEFAULT_LOCATION = 'us-central1';
export const DEFAULT_MODEL = 'gemini-2.0-flash';
export const DEFAULT_VOICE = 'Puck';
export const VERTEX_BIDI_PATH = '/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent';

export interface VoiceConfig {
  projectId?: string;
  location?: string;
  token?: string;
  voice?: string;
  model?: string;
}

function getVoiceConfigPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return path.join(home, '.gemini', 'antigravity', 'voice_config.json');
}

export function loadVoiceConfig(): VoiceConfig {
  try {
    const p = getVoiceConfigPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  } catch (_) {}
  return {};
}

export function saveVoiceConfig(config: VoiceConfig): void {
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
  defaultLocation?: string;
  systemInstruction?: string;
}

/**
 * Lightweight RFC-6455 WebSocket connection over a net.Socket / tls.TLSSocket.
 * Supports both server mode (incoming from frontend) and client mode (outgoing to Vertex AI).
 */
export class LocalWsConnection extends EventEmitter {
  public socket: net.Socket | tls.TLSSocket;
  public readyState: number = 1; // 1 = OPEN
  public isClient: boolean = false;
  private buffer: Buffer = Buffer.alloc(0);

  constructor(socket: net.Socket | tls.TLSSocket, isClient: boolean = false) {
    super();
    this.socket = socket;
    this.isClient = isClient;

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
    const frame = encodeFrame(data, isBinary, this.isClient);
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
      this.socket.write(encodeFrame(payload, true, this.isClient, 0x08));
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

      // Unmask payload if masked
      if (maskKey) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= maskKey[i % 4];
        }
      }

      // Handle Opcodes
      if (opcode === 0x08) {
        // Close frame
        let code = 1000;
        let reason = '';
        if (payload.length >= 2) {
          code = payload.readUInt16BE(0);
          reason = payload.subarray(2).toString('utf-8');
        }
        this.emit('close', code, reason);
        this.close(code, reason);
        return;
      } else if (opcode === 0x09) {
        // Ping -> Reply Pong
        this.socket.write(encodeFrame(payload, true, this.isClient, 0x0a));
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

export function encodeFrame(
  data: Buffer | string,
  isBinary: boolean,
  isClient: boolean = false,
  customOpcode?: number,
): Buffer {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8');
  const len = payload.length;
  const opcode = customOpcode !== undefined ? customOpcode : isBinary ? 0x02 : 0x01;
  const firstByte = 0x80 | opcode; // FIN = 1
  const maskBit = isClient ? 0x80 : 0x00;

  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = firstByte;
    header[1] = maskBit | len;
  } else if (len <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = firstByte;
    header[1] = maskBit | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = firstByte;
    header[1] = maskBit | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  if (isClient) {
    const maskKey = crypto.randomBytes(4);
    const masked = Buffer.alloc(len);
    for (let i = 0; i < len; i++) {
      masked[i] = payload[i] ^ maskKey[i % 4];
    }
    return Buffer.concat([header, maskKey, masked]);
  }

  return Buffer.concat([header, payload]);
}

export class VoiceGateway {
  private getApiKey: () => string | null;
  private defaultVoice: string;
  private defaultModel: string;
  private defaultLocation: string;
  private systemInstruction: string;
  private activeClients: Set<LocalWsConnection> = new Set();
  private activeGcpContext: { projectId?: string; token?: string } = {};

  constructor(options: VoiceGatewayOptions) {
    this.getApiKey = options.getApiKey;
    this.defaultVoice = options.defaultVoice || DEFAULT_VOICE;
    this.defaultModel = options.defaultModel || DEFAULT_MODEL;
    this.defaultLocation = options.defaultLocation || DEFAULT_LOCATION;
    this.systemInstruction =
      options.systemInstruction ||
      'You are Antigravity\'s real-time AI pair programmer. You are sharp, concise, friendly, and speak naturally. Provide quick, accurate, conversational answers suitable for spoken audio without markdown tables or code formatting.';
  }

  public setActiveGcpContext(ctx: { projectId?: string; token?: string }): void {
    if (ctx.projectId) this.activeGcpContext.projectId = ctx.projectId;
    if (ctx.token) this.activeGcpContext.token = ctx.token;
    log.info(
      `[VoiceGateway] Active GCP context updated: project=${this.activeGcpContext.projectId}, hasToken=${Boolean(
        this.activeGcpContext.token,
      )}`,
    );
  }

  public getActiveGcpContext(): { projectId?: string; token?: string } {
    return { ...this.activeGcpContext };
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

    const clientWs = new LocalWsConnection(socket, false);
    this.activeClients.add(clientWs);

    clientWs.on('close', () => {
      this.activeClients.delete(clientWs);
    });

    const explicitToken = url.searchParams.get('token') || url.searchParams.get('key') || undefined;
    const explicitProject = url.searchParams.get('project') || undefined;
    const explicitLocation = url.searchParams.get('location') || undefined;

    this.handleClientSession(clientWs, explicitToken, explicitProject, explicitLocation);
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

  private handleClientSession(
    clientWs: LocalWsConnection,
    explicitToken?: string,
    explicitProject?: string,
    explicitLocation?: string,
  ): void {
    const voiceCfg = loadVoiceConfig();

    const rawToken =
      explicitToken ||
      voiceCfg.token ||
      this.activeGcpContext.token ||
      this.getApiKey() ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY;

    const cleanToken = rawToken ? rawToken.replace(/^Bearer\s+/i, '').trim() : '';

    const projectId =
      explicitProject ||
      voiceCfg.projectId ||
      this.activeGcpContext.projectId ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCP_PROJECT ||
      process.env.PROJECT_ID ||
      '';

    const location = explicitLocation || voiceCfg.location || this.defaultLocation;
    const model = voiceCfg.model || this.defaultModel;
    const voice = voiceCfg.voice || this.defaultVoice;

    if (!cleanToken) {
      log.warn('[VoiceGateway] Connection rejected: No Bearer / OAuth token configured.');
      clientWs.send(
        JSON.stringify({
          type: 'error',
          code: 1008,
          error:
            'No Google Cloud token found. Please configure your GCP OAuth Bearer Token in the Live Voice Debug Console.',
        }),
      );
      clientWs.close(1008, 'Token Missing');
      return;
    }

    const host = `${location}-aiplatform.googleapis.com`;
    const path = VERTEX_BIDI_PATH;
    const secKey = crypto.randomBytes(16).toString('base64');

    log.info(
      `[VoiceGateway] Connecting upstream to Vertex AI: wss://${host}${path} (project: ${projectId || 'unspecified'}, location: ${location})`,
    );

    let upstreamWs: LocalWsConnection | null = null;
    let upstreamReady = false;
    const pendingAudioQueue: Buffer[] = [];

    const req = https.request({
      hostname: host,
      port: 443,
      path: path,
      method: 'GET',
      headers: {
        Host: host,
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': secKey,
        'Sec-WebSocket-Version': '13',
        Authorization: `Bearer ${cleanToken}`,
      },
    });

    req.on('response', (res) => {
      let body = '';
      res.on('data', (d: Buffer) => (body += d.toString('utf-8')));
      res.on('end', () => {
        log.error(`[VoiceGateway] Vertex AI handshake rejected (HTTP ${res.statusCode} ${res.statusMessage}): ${body}`);
        let friendly = `Vertex AI Error (HTTP ${res.statusCode}): ${res.statusMessage}`;
        try {
          const json = JSON.parse(body);
          if (json.error && json.error.message) {
            friendly = `Vertex AI: ${json.error.message}`;
          }
        } catch (_) {}

        if (clientWs.readyState === 1) {
          clientWs.send(
            JSON.stringify({
              type: 'error',
              code: res.statusCode || 1011,
              error: friendly,
              raw: body,
            }),
          );
          clientWs.close(1011, 'Upstream Handshake Failed');
        }
      });
    });

    req.on('error', (err) => {
      log.error('[VoiceGateway] Upstream request error:', err);
      if (clientWs.readyState === 1) {
        clientWs.send(
          JSON.stringify({
            type: 'error',
            error: `Failed to connect to Vertex AI (${host}): ${err.message}`,
          }),
        );
        clientWs.close(1011, 'Network Error');
      }
    });

    req.on('upgrade', (_res, rawSocket, _head) => {
      log.info(`[VoiceGateway] Vertex AI WebSocket upgrade successful. Initializing session...`);
      upstreamWs = new LocalWsConnection(rawSocket as tls.TLSSocket, true);

      // Construct model string
      const modelPath = projectId
        ? `projects/${projectId}/locations/${location}/publishers/google/models/${model}`
        : `publishers/google/models/${model}`;

      const setupMessage = {
        setup: {
          model: modelPath,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: voice,
                },
              },
            },
          },
          systemInstruction: {
            parts: [{ text: this.systemInstruction }],
          },
        },
      };

      log.info(`[VoiceGateway] Sending Vertex AI setup frame for model: ${modelPath}`);
      upstreamWs.send(JSON.stringify(setupMessage));

      upstreamWs.on('message', (data: string | Buffer) => {
        try {
          const raw = typeof data === 'string' ? data : data.toString('utf-8');
          const parsed = JSON.parse(raw);

          if (parsed.setupComplete) {
            log.info('[VoiceGateway] Vertex AI setup complete. Audio stream ready.');
            upstreamReady = true;

            while (pendingAudioQueue.length > 0) {
              const chunk = pendingAudioQueue.shift();
              if (chunk && upstreamWs?.readyState === 1) {
                this.sendAudioChunkToUpstream(upstreamWs, chunk);
              }
            }

            clientWs.send(
              JSON.stringify({
                type: 'ready',
                model,
                voice,
                location,
                projectId,
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

          if (parsed.error) {
            log.error('[VoiceGateway] Vertex AI returned error frame:', parsed.error);
            clientWs.send(
              JSON.stringify({
                type: 'error',
                error: parsed.error.message || 'Vertex AI error',
                details: parsed.error,
              }),
            );
          }
        } catch (err) {
          log.error('[VoiceGateway] Error parsing upstream message:', err);
        }
      });

      upstreamWs.on('close', (code?: number, reason?: string) => {
        const c = code || 1000;
        const r = reason || '';
        log.warn(`[VoiceGateway] Vertex AI WebSocket closed: code=${c}, reason="${r}"`);
        if (clientWs.readyState === 1) {
          clientWs.send(
            JSON.stringify({
              type: 'closed',
              code: c,
              reason: r,
            }),
          );
          clientWs.close(c, r);
        }
      });

      upstreamWs.on('error', (err) => {
        log.error('[VoiceGateway] Vertex AI WebSocket socket error:', err);
        if (clientWs.readyState === 1) {
          clientWs.send(
            JSON.stringify({
              type: 'error',
              error: err.message || 'Vertex AI socket error',
            }),
          );
        }
      });
    });

    req.end();

    // ─── Client Message Handlers ──────────────────────────────────────────

    clientWs.on('message', (message: string | Buffer, isBinary: boolean) => {
      try {
        if (isBinary || Buffer.isBuffer(message)) {
          const buf = Buffer.isBuffer(message) ? message : Buffer.from(message);
          if (!upstreamReady || !upstreamWs || upstreamWs.readyState !== 1) {
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
                hasToken: Boolean(cleanToken),
                projectId: projectId || null,
                location,
                upstreamReady,
                upstreamState: upstreamWs ? upstreamWs.readyState : -1,
              }),
            );
          } else if (parsed.type === 'audio' && parsed.data) {
            const buf = Buffer.from(parsed.data, 'base64');
            if (!upstreamReady || !upstreamWs || upstreamWs.readyState !== 1) {
              if (pendingAudioQueue.length < 25) pendingAudioQueue.push(buf);
              return;
            }
            this.sendAudioChunkToUpstream(upstreamWs, buf);
          } else if (parsed.type === 'text' && parsed.text) {
            if (upstreamWs && upstreamWs.readyState === 1) {
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
          } else if (parsed.type === 'save_config') {
            saveVoiceConfig({
              projectId: parsed.projectId ? parsed.projectId.trim() : undefined,
              location: parsed.location ? parsed.location.trim() : undefined,
              token: parsed.token ? parsed.token.trim() : undefined,
              model: parsed.model ? parsed.model.trim() : undefined,
              voice: parsed.voice ? parsed.voice.trim() : undefined,
            });
            log.info('[VoiceGateway] Saved voice configuration.');
            clientWs.send(JSON.stringify({ type: 'config_saved', success: true }));
          }
        }
      } catch (err) {
        log.error('[VoiceGateway] Error handling client message:', err);
      }
    });

    clientWs.on('close', () => {
      log.info('[VoiceGateway] Client disconnected.');
      if (upstreamWs && upstreamWs.readyState === 1) {
        upstreamWs.close(1000, 'Client disconnected');
      }
    });
  }

  private sendAudioChunkToUpstream(ws: LocalWsConnection, pcmBuffer: Buffer): void {
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
