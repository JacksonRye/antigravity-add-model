import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { getRequiredProxyPort, listenProxy } from '../proxy/listen';

const compiled = ts.transpileModule(fs.readFileSync(path.resolve('src/proxy.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;

class FakeServer extends EventEmitter {
  listening = false;
  port = 0;
  listen = vi.fn((port: number, _host: string) => {
    this.port = port || 61000;
    return this;
  });
  close = vi.fn((callback: () => void) => {
    this.listening = false;
    callback();
    return this;
  });
  address() {
    return { port: this.port, address: '127.0.0.1', family: 'IPv4' };
  }
  ready() {
    this.listening = true;
    this.emit('listening');
  }
}

interface ProxyModule {
  startProxy(): Promise<number>;
  stopProxy(): Promise<void>;
  getProxyPort(): number;
}
const fixtures: { module: ProxyModule; directory: string; servers: FakeServer[] }[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    for (const server of fixture.servers) if (server.listenerCount('listening')) server.ready();
    await fixture.module.stopProxy();
    if (
      path.dirname(fixture.directory) !== path.resolve(tmpdir()) ||
      !path.basename(fixture.directory).startsWith('agy-proxy-lifecycle-')
    ) {
      throw new Error('Unexpected fixture cleanup path');
    }
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

function fixture(fixed = true) {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'agy-proxy-lifecycle-'));
  if (fixed) fs.writeFileSync(path.join(directory, 'antigravity-proxy.json'), '{"requiredPort":50999}');
  const servers: FakeServer[] = [];
  const createServer = vi.fn(() => {
    const server = new FakeServer();
    servers.push(server);
    return server;
  });
  const startCleanupInterval = vi.fn();
  const stopCleanupInterval = vi.fn();
  const dependencies: Record<string, unknown> = {
    http: { createServer },
    https: {},
    fs: {},
    path,
    electron: { app: { getAppPath: () => directory } },
    'electron-log': { info: vi.fn(), error: vi.fn() },
    './proxy/shared': { startCleanupInterval, stopCleanupInterval },
    './proxy/modelUtils': {},
    './proxy/registry': {},
    './cryptoStore': {},
    './proxy/voiceGateway': { attachVoiceGateway: vi.fn(() => ({ close: vi.fn() })) },
    // These are the production marker parser and listener, with only the socket mocked.
    './proxy/listen': { getRequiredProxyPort, listenProxy },
  };
  const module = { exports: {} as ProxyModule };
  runInNewContext(compiled, {
    exports: module.exports,
    module,
    require: (id: string) => {
      if (!Object.hasOwn(dependencies, id)) throw new Error(`Unexpected proxy dependency: ${id}`);
      return dependencies[id];
    },
    console,
  });
  fixtures.push({ module: module.exports, directory, servers });
  return { ...module.exports, servers, createServer, startCleanupInterval, stopCleanupInterval };
}

describe('proxy lifecycle across language-server restarts', () => {
  it('reuses its existing listener when the fixed-port language server restarts', async () => {
    const proxy = fixture();
    const initial = proxy.startProxy();
    expect(proxy.servers[0].listen).toHaveBeenCalledWith(50999, '127.0.0.1');
    proxy.servers[0].ready();
    await expect(initial).resolves.toBe(50999);
    await expect(proxy.startProxy()).resolves.toBe(50999);
    expect(proxy.createServer).toHaveBeenCalledOnce();
    expect(proxy.startCleanupInterval).toHaveBeenCalledOnce();
  });

  it('coalesces concurrent startup requests onto one in-flight listener', async () => {
    const proxy = fixture();
    const first = proxy.startProxy();
    const second = proxy.startProxy();
    expect(proxy.createServer).toHaveBeenCalledOnce();
    proxy.servers[0].ready();
    await expect(Promise.all([first, second])).resolves.toEqual([50999, 50999]);
  });

  it('clears a failed start so a later retry can bind the fixed port', async () => {
    const proxy = fixture();
    const failed = proxy.startProxy();
    const assertion = expect(failed).rejects.toMatchObject({ code: 'EADDRINUSE' });
    proxy.servers[0].emit('error', Object.assign(new Error('Port occupied'), { code: 'EADDRINUSE' }));
    await assertion;
    expect(proxy.getProxyPort()).toBe(0);
    expect(proxy.stopCleanupInterval).toHaveBeenCalledOnce();

    const retried = proxy.startProxy();
    expect(proxy.createServer).toHaveBeenCalledTimes(2);
    proxy.servers[1].ready();
    await expect(retried).resolves.toBe(50999);
  });

  it('clears the bound port on shutdown and allows an explicit fresh start', async () => {
    const proxy = fixture();
    const started = proxy.startProxy();
    proxy.servers[0].ready();
    await started;
    await Promise.all([proxy.stopProxy(), proxy.stopProxy()]);
    expect(proxy.servers[0].close).toHaveBeenCalledOnce();
    expect(proxy.getProxyPort()).toBe(0);
    const restarted = proxy.startProxy();
    proxy.servers[1].ready();
    await expect(restarted).resolves.toBe(50999);
  });

  it('waits for an in-flight start before shutting its listener down', async () => {
    const proxy = fixture();
    const started = proxy.startProxy();
    const stopped = proxy.stopProxy();
    expect(proxy.servers[0].close).not.toHaveBeenCalled();
    proxy.servers[0].ready();
    await started;
    await stopped;
    expect(proxy.servers[0].close).toHaveBeenCalledOnce();
    expect(proxy.getProxyPort()).toBe(0);
  });

  it('queues a start requested while the old listener is shutting down', async () => {
    const proxy = fixture();
    const started = proxy.startProxy();
    proxy.servers[0].ready();
    await started;
    let finishClose = () => {};
    proxy.servers[0].close.mockImplementation((callback) => {
      finishClose = () => {
        proxy.servers[0].listening = false;
        callback();
      };
      return proxy.servers[0];
    });
    const stopped = proxy.stopProxy();
    const restarted = proxy.startProxy();
    expect(proxy.createServer).toHaveBeenCalledOnce();
    finishClose();
    await stopped;
    await new Promise((resolve) => setImmediate(resolve));
    expect(proxy.createServer).toHaveBeenCalledTimes(2);
    proxy.servers[1].ready();
    await expect(restarted).resolves.toBe(50999);
  });

  it('continues to reuse the dynamic fallback for an unpatched application', async () => {
    const proxy = fixture(false);
    const started = proxy.startProxy();
    proxy.servers[0].emit('error', Object.assign(new Error('Port occupied'), { code: 'EADDRINUSE' }));
    expect(proxy.servers[0].listen).toHaveBeenLastCalledWith(0, '127.0.0.1');
    proxy.servers[0].ready();
    await expect(started).resolves.toBe(61000);
    await expect(proxy.startProxy()).resolves.toBe(61000);
    expect(proxy.createServer).toHaveBeenCalledOnce();
  });
});
