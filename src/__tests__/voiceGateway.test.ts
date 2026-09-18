import { describe, it, expect, vi } from 'vitest';
import { VoiceGateway } from '../proxy/voiceGateway';
import { EventEmitter } from 'events';

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
});
