import { describe, it, expect, vi } from 'vitest';
import { VoiceGateway, encodeFrame, LocalWsConnection, pcmToWav } from '../proxy/voiceGateway';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('VoiceGateway', () => {
  it('correctly handles upgrade requests for /ws/live and performs RFC-6455 handshake', () => {
    const gateway = new VoiceGateway({
      getApiKey: () => 'test-api-key',
    });

    const mockReq = {
      url: '/ws/live',
      headers: {
        host: '127.0.0.1:50999',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    } as any;

    let writtenData = '';
    const mockSocket = Object.assign(new EventEmitter(), {
      write: vi.fn((data: string) => {
        writtenData += data;
        return true;
      }),
      end: vi.fn(),
      destroy: vi.fn(),
      destroyed: false,
    });

    const handled = gateway.handleUpgrade(mockReq, mockSocket as any, Buffer.from([]));
    expect(handled).toBe(true);
    expect(mockSocket.write).toHaveBeenCalled();
    expect(writtenData).toContain('HTTP/1.1 101 Switching Protocols');
    expect(writtenData).toContain('Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');

    gateway.close();
  });

  it('rejects upgrade requests for unrelated paths', () => {
    const gateway = new VoiceGateway({
      getApiKey: () => 'test-api-key',
    });

    const mockReq = {
      url: '/v1/chat/completions',
      headers: { host: '127.0.0.1:50999' },
    } as any;

    const mockSocket = new EventEmitter();
    const handled = gateway.handleUpgrade(mockReq, mockSocket as any, Buffer.from([]));
    expect(handled).toBe(false);
  });

  it('correctly tracks and provides active GCP context', () => {
    const gateway = new VoiceGateway({
      getApiKey: () => 'fallback-key',
    });

    expect(gateway.getActiveGcpContext().projectId).toBeUndefined();

    gateway.setActiveGcpContext({ projectId: 'test-gcp-project', token: 'Bearer test-token' });
    const ctx = gateway.getActiveGcpContext();
    expect(ctx.projectId).toBe('test-gcp-project');
    expect(ctx.token).toBe('Bearer test-token');

    gateway.close();
  });

  it('encodes unmasked server frames and masked client frames per RFC-6455', () => {
    const text = 'Hello Vertex AI';
    
    // Server frame (unmasked)
    const serverFrame = encodeFrame(text, false, false);
    expect(serverFrame[0]).toBe(0x81); // FIN + text opcode 0x01
    expect(serverFrame[1] & 0x80).toBe(0x00); // Mask bit 0
    expect(serverFrame.subarray(2).toString('utf-8')).toBe(text);

    // Client frame (masked)
    const clientFrame = encodeFrame(text, false, true);
    expect(clientFrame[0]).toBe(0x81); // FIN + text opcode 0x01
    expect(clientFrame[1] & 0x80).toBe(0x80); // Mask bit 1
    const maskKey = clientFrame.subarray(2, 6);
    expect(maskKey.length).toBe(4);

    const maskedPayload = Buffer.from(clientFrame.subarray(6));
    for (let i = 0; i < maskedPayload.length; i++) {
      maskedPayload[i] ^= maskKey[i % 4];
    }
    expect(maskedPayload.toString('utf-8')).toBe(text);
  });

  it('decodes incoming frames in LocalWsConnection', () => {
    const mockSocket = Object.assign(new EventEmitter(), {
      write: vi.fn(),
      end: vi.fn(),
      destroy: vi.fn(),
      destroyed: false,
    });

    const conn = new LocalWsConnection(mockSocket as any, false);
    let receivedMessage = '';

    conn.on('message', (msg: string) => {
      receivedMessage = msg;
    });

    // Send a frame into socket
    const frame = encodeFrame('test payload', false, false);
    mockSocket.emit('data', frame);

    expect(receivedMessage).toBe('test payload');
    conn.close();
  });

  it('correctly converts PCM buffer to valid WAV buffer with header', () => {
    const pcmData = Buffer.alloc(4800, 0x12); // dummy 16-bit PCM samples
    const wav = pcmToWav(pcmData, 24000, 1, 16);

    expect(wav.length).toBe(4800 + 44);
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.subarray(8, 12).toString()).toBe('WAVE');
    expect(wav.subarray(12, 16).toString()).toBe('fmt ');
    expect(wav.readUInt32LE(24)).toBe(24000); // sample rate
    expect(wav.readUInt16LE(22)).toBe(1); // num channels
    expect(wav.readUInt16LE(34)).toBe(16); // bit depth
    expect(wav.subarray(36, 40).toString()).toBe('data');
    expect(wav.readUInt32LE(40)).toBe(4800); // data length
  });
});

