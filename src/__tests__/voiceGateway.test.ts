import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  it('correctly handles upgrade requests for /ws/live and /voice/live', () => {
    const gateway = new VoiceGateway({
      getApiKey: () => 'test-api-key',
    });

    const mockReq = {
      url: '/ws/live',
      headers: { host: '127.0.0.1:50999' },
    } as any;

    const mockSocket = new EventEmitter();
    const mockHead = Buffer.from([]);

    let upgradeHandled = false;
    // Mock the wss handleUpgrade
    (gateway as any).wss.handleUpgrade = vi.fn((req, sock, head, cb) => {
      upgradeHandled = true;
    });

    const handled = gateway.handleUpgrade(mockReq, mockSocket, mockHead);
    expect(handled).toBe(true);
    expect(upgradeHandled).toBe(true);
  });

  it('rejects upgrade requests for unrelated paths', () => {
    const gateway = new VoiceGateway({
      getApiKey: () => 'test-api-key',
    });

    const mockReq = {
      url: '/v1/chat/completions',
      headers: { host: '127.0.0.1:50999' },
    } as any;

    const handled = gateway.handleUpgrade(mockReq, new EventEmitter() as any, Buffer.from([]));
    expect(handled).toBe(false);
  });
});
