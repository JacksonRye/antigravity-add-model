/**
 * Real-time Voice Gateway for Antigravity.
 * Powered by Google Cloud Vertex AI REST (generateContent) using zero-friction direct API key authorization.
 * Supports rapid turn-taking audio streaming and conversation with Gemini 3.6/3.7 Flash models.
 * Built with zero external dependencies using Node.js native HTTPS/TLS and RFC-6455 WebSocket framing.
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
export const DEFAULT_MODELS = ['gemini-3.6-flash', 'gemini-3.7-flash'];
export const DEFAULT_API_KEY = 'YOUR_API_KEY_HERE';

export interface VoiceConfig {
  apiKey?: string;
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
 * Packs 16-bit PCM buffer into standard WAV (RIFF header + PCM payload).
 */
export function pcmToWav(
  pcmBuffer: Buffer,
  sampleRate: number = 24000,
  numChannels: number = 1,
  bitDepth: number = 16,
): Buffer {
  const header = Buffer.alloc(44);
  const dataLen = pcmBuffer.length;
  const fileLen = dataLen + 36;
  const byteRate = (sampleRate * numChannels * bitDepth) / 8;
  const blockAlign = (numChannels * bitDepth) / 8;

  header.write('RIFF', 0);
  header.writeUInt32LE(fileLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // SubChunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);

  return Buffer.concat([header, pcmBuffer]);
}

/**
 * Execute a POST request to Vertex AI generateContent with automatic model fallback.
 */
export async function executeVertexRest(
  payload: any,
  apiKey: string,
  candidateModels: string[] = DEFAULT_MODELS,
): Promise<{ text: string; model: string }> {
  let lastError: Error | null = null;

  for (const model of candidateModels) {
    try {
      const url = `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=${apiKey}`;
      const jsonBody = JSON.stringify(payload);

      const responseText = await new Promise<string>((resolve, reject) => {
        const parsedUrl = new URL(url);
        const req = https.request(
          {
            hostname: parsedUrl.hostname,
            port: 443,
            path: `${parsedUrl.pathname}${parsedUrl.search}`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(jsonBody),
            },
            timeout: 15000,
          },
          (res) => {
            let body = '';
            res.on('data', (d) => (body += d.toString()));
            res.on('end', () => {
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                resolve(body);
              } else {
                reject(new Error(`Vertex AI HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
              }
            });
          },
        );

        req.on('error', (err) => reject(err));
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Vertex AI request timeout'));
        });

        req.write(jsonBody);
        req.end();
      });

      const parsed = JSON.parse(responseText);
      const candidates = parsed.candidates || [];
      if (candidates.length > 0 && candidates[0].content && candidates[0].content.parts) {
        const text = candidates[0].content.parts
          .map((p: any) => p.text || '')
          .join('')
          .trim();
        return { text, model };
      }

      return { text: '', model };
    } catch (err: any) {
      log.warn(`[VoiceGateway] Vertex model ${model} failed: ${err.message}`);
      lastError = err;
    }
  }

  throw lastError || new Error('All Vertex candidate models failed.');
}

/**
 * Lightweight RFC-6455 WebSocket connection over a net.Socket / tls.TLSSocket.
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
  private systemInstruction: string;
  private activeClients: Set<LocalWsConnection> = new Set();
  private activeGcpContext: { projectId?: string; token?: string } = {};

  constructor(options: VoiceGatewayOptions) {
    this.getApiKey = options.getApiKey;
    this.defaultVoice = options.defaultVoice || 'Puck';
    this.defaultModel = options.defaultModel || DEFAULT_MODELS[0];
    this.systemInstruction =
      options.systemInstruction ||
      'You are Antigravity\'s live voice pair programmer. Speak directly, concisely (1-2 sentences), and conversationally. Do not output markdown tables or code formatting.';
  }

  public setActiveGcpContext(ctx: { projectId?: string; token?: string }): void {
    if (ctx.projectId) this.activeGcpContext.projectId = ctx.projectId;
    if (ctx.token) this.activeGcpContext.token = ctx.token;
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

    const explicitKey = url.searchParams.get('key') || url.searchParams.get('token') || undefined;
    const explicitModel = url.searchParams.get('model') || undefined;

    this.handleClientSession(clientWs, explicitKey, explicitModel);
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
    explicitKey?: string,
    explicitModel?: string,
  ): void {
    const voiceCfg = loadVoiceConfig();
    const effectiveKey =
      explicitKey ||
      voiceCfg.apiKey ||
      voiceCfg.token ||
      this.getApiKey() ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      DEFAULT_API_KEY;

    const candidateModels = explicitModel
      ? [explicitModel, ...DEFAULT_MODELS]
      : voiceCfg.model
      ? [voiceCfg.model, ...DEFAULT_MODELS]
      : DEFAULT_MODELS;

    log.info(`[VoiceGateway] Client connected. Using Vertex REST with model candidates: ${candidateModels.join(', ')}`);

    // Signal ready immediately to frontend
    clientWs.send(
      JSON.stringify({
        type: 'ready',
        model: candidateModels[0],
        voice: voiceCfg.voice || this.defaultVoice,
        mode: 'rest',
      }),
    );

    let audioBuffers: Buffer[] = [];

    clientWs.on('message', async (message: string | Buffer, isBinary: boolean) => {
      try {
        if (isBinary || Buffer.isBuffer(message)) {
          const buf = Buffer.isBuffer(message) ? message : Buffer.from(message);
          audioBuffers.push(buf);
          return;
        }

        const parsed = JSON.parse(message.toString());

        if (parsed.type === 'ping') {
          clientWs.send(
            JSON.stringify({
              type: 'pong',
              timestamp: Date.now(),
              activeModel: candidateModels[0],
              hasKey: Boolean(effectiveKey),
              mode: 'rest',
            }),
          );
        } else if (parsed.type === 'audio_chunk' && parsed.data) {
          const buf = Buffer.from(parsed.data, 'base64');
          audioBuffers.push(buf);
        } else if (parsed.type === 'commit' || parsed.type === 'process_audio') {
          if (audioBuffers.length === 0) {
            clientWs.send(JSON.stringify({ type: 'turn_complete' }));
            return;
          }

          const rawPcm = Buffer.concat(audioBuffers);
          audioBuffers = [];

          const wavBuffer = pcmToWav(rawPcm, 24000, 1, 16);
          const base64Wav = wavBuffer.toString('base64');

          log.info(`[VoiceGateway] Processing spoken audio turn (${wavBuffer.length} bytes)...`);

          const payload = {
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: this.systemInstruction,
                  },
                  {
                    inline_data: {
                      mime_type: 'audio/wav',
                      data: base64Wav,
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              thinking_config: { thinking_budget: 0 },
              temperature: 0.2,
            },
          };

          try {
            const { text, model } = await executeVertexRest(payload, effectiveKey, candidateModels);
            log.info(`[VoiceGateway] Model '${model}' responded (${text.length} chars)`);
            clientWs.send(
              JSON.stringify({
                type: 'text',
                text,
                model,
              }),
            );
          } catch (err: any) {
            log.error('[VoiceGateway] Audio turn execution error:', err);
            clientWs.send(
              JSON.stringify({
                type: 'error',
                error: `Vertex AI error: ${err.message}`,
              }),
            );
          } finally {
            clientWs.send(JSON.stringify({ type: 'turn_complete' }));
          }
        } else if (parsed.type === 'transcribe') {
          if (audioBuffers.length === 0) {
            clientWs.send(JSON.stringify({ type: 'transcript', text: '' }));
            return;
          }

          const rawPcm = Buffer.concat(audioBuffers);
          audioBuffers = [];

          const wavBuffer = pcmToWav(rawPcm, 24000, 1, 16);
          const base64Wav = wavBuffer.toString('base64');

          const payload = {
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: 'Accurately transcribe the spoken words in this audio recording verbatim. Output only the transcribed text without commentary or filler.',
                  },
                  {
                    inline_data: {
                      mime_type: 'audio/wav',
                      data: base64Wav,
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              thinking_config: { thinking_budget: 0 },
              temperature: 0.0,
            },
          };

          try {
            const { text } = await executeVertexRest(payload, effectiveKey, candidateModels);
            clientWs.send(JSON.stringify({ type: 'transcript', text }));
          } catch (err: any) {
            clientWs.send(JSON.stringify({ type: 'error', error: err.message }));
          }
        } else if (parsed.type === 'text' && parsed.text) {
          const payload = {
            contents: [
              {
                role: 'user',
                parts: [
                  { text: this.systemInstruction },
                  { text: parsed.text },
                ],
              },
            ],
            generationConfig: {
              thinking_config: { thinking_budget: 0 },
              temperature: 0.2,
            },
          };

          try {
            const { text, model } = await executeVertexRest(payload, effectiveKey, candidateModels);
            clientWs.send(JSON.stringify({ type: 'text', text, model }));
          } catch (err: any) {
            clientWs.send(JSON.stringify({ type: 'error', error: err.message }));
          } finally {
            clientWs.send(JSON.stringify({ type: 'turn_complete' }));
          }
        } else if (parsed.type === 'clear_audio') {
          audioBuffers = [];
        } else if (parsed.type === 'save_config') {
          saveVoiceConfig({
            apiKey: parsed.apiKey || parsed.token || undefined,
            model: parsed.model || undefined,
            voice: parsed.voice || undefined,
          });
          clientWs.send(JSON.stringify({ type: 'config_saved', success: true }));
        }
      } catch (err: any) {
        log.error('[VoiceGateway] Message handler error:', err);
      }
    });
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
