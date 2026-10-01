/**
 * Preload script — runs in every BrowserWindow before the page loads.
 * Exposes a minimal, secure API via contextBridge so the renderer can
 * communicate with the main-process auto-updater without nodeIntegration.
 */

import { contextBridge, ipcRenderer, webFrame } from 'electron';

// ─── Type Declarations for APIs exposed to renderer ──────────────────────────

interface UpdaterState {
  type: string;
  update?: { version: string };
}

type UnsubscribeFn = () => void;

interface UpdaterAPI {
  onStateChanged: (callback: (state: UpdaterState) => void) => UnsubscribeFn;
  applyUpdate: () => Promise<void>;
  quitAndInstall: () => Promise<void>;
  checkForUpdates: () => Promise<void>;
  getState: () => Promise<UpdaterState>;
}

interface DialogAPI {
  showOpenDialog: () => Promise<string | undefined>;
  showOpenMultipleFolderDialog: () => Promise<string[] | undefined>;
}

interface NotificationOptions {
  title: string;
  body: string;
  silent?: boolean;
  payload?: unknown;
}

interface NotificationAPI {
  send: (options: NotificationOptions) => Promise<void>;
  openSystemPreferences: () => Promise<void>;
  onClicked: (callback: (payload: unknown) => void) => UnsubscribeFn;
}

interface StorageAPI {
  getItems: () => Promise<Record<string, string | null>>;
  updateItems: (changes: Record<string, string | null>) => Promise<void>;
  onChanged: (callback: (changes: Record<string, string | null>) => void) => UnsubscribeFn;
  getCustomModels: () => Promise<CustomModelEntry[]>;
  saveCustomModel: (model: CustomModelEntry) => Promise<{ success: boolean; error?: string }>;
  deleteCustomModel: (modelName: string) => Promise<{ success: boolean; error?: string }>;
  testModelConnection: (model: TestModelParams) => Promise<ConnectionTestResult>;
}

interface LogsAPI {
  getElectronLogs: () => Promise<string>;
}

interface ExtensionsAPI {
  sendAuthorities: (authoritiesMap: Record<string, string>) => Promise<void>;
}

interface DeepLinkAPI {
  onDeepLink: (callback: (url: string) => void) => UnsubscribeFn;
  getStoredDeepLink: () => Promise<string | undefined>;
}

interface AgentAPI {
  updateActiveAgentCount: (count: number) => Promise<void>;
}

interface TitleBarOverlayOptions {
  color: string;
  symbolColor: string;
}

interface ElectronNativeAPI {
  getZoomLevel: () => number;
  setTitleBarOverlay: (options: TitleBarOverlayOptions) => Promise<void>;
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  unmaximize: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  close: () => Promise<void>;
  toggleDevTools: () => Promise<void>;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  openExternal: (url: string) => Promise<void>;
  revealInFilePicker: (path: string) => Promise<void>;
}

interface IdeAPI {
  isInstalled: () => Promise<boolean>;
}

interface CustomModelEntry {
  name: string;
  displayName?: string;
  description?: string;
  provider: string;
  apiKey: string;
  apiUrl: string;
  externalModelName: string;
  allowUnauthorized?: boolean;
  encrypted?: boolean;
  [key: string]: unknown;
}

interface TestModelParams {
  apiUrl: string;
  provider: string;
  apiKey?: string;
  allowUnauthorized?: boolean;
}

interface ConnectionTestResult {
  success: boolean;
  status?: number;
  message?: string;
  error?: string;
}

// ─── API Definitions ─────────────────────────────────────────────────────────

const updaterAPI: UpdaterAPI = {
  onStateChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, state: UpdaterState) => {
      callback(state);
    };
    ipcRenderer.on('updater:state-changed', handler);
    // Return unsubscribe function
    return () => {
      ipcRenderer.removeListener('updater:state-changed', handler);
    };
  },
  applyUpdate: () => ipcRenderer.invoke('updater:apply'),
  quitAndInstall: () => ipcRenderer.invoke('updater:quit-and-install'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check-for-updates'),
  getState: () => ipcRenderer.invoke('updater:get-state'),
};

const dialogAPI: DialogAPI = {
  showOpenDialog: () => ipcRenderer.invoke('dialog:open-workspace'),
  showOpenMultipleFolderDialog: () => ipcRenderer.invoke('dialog:open-workspaces'),
};

const notificationAPI: NotificationAPI = {
  send: (options) => ipcRenderer.invoke('notification:send', options),
  openSystemPreferences: () => ipcRenderer.invoke('notification:open-system-preferences'),
  onClicked: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      callback(payload);
    };
    ipcRenderer.on('notification:clicked', handler);
    return () => {
      ipcRenderer.removeListener('notification:clicked', handler);
    };
  },
};

const storageAPI: StorageAPI = {
  getItems: () => ipcRenderer.invoke('storage:get-items'),
  updateItems: (changes) => ipcRenderer.invoke('storage:update-items', changes),
  onChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, changes: Record<string, string | null>) => {
      callback(changes);
    };
    ipcRenderer.on('storage:changed', handler);
    return () => {
      ipcRenderer.removeListener('storage:changed', handler);
    };
  },
  getCustomModels: () => ipcRenderer.invoke('storage:get-custom-models'),
  saveCustomModel: (model) => ipcRenderer.invoke('storage:save-custom-model', model),
  deleteCustomModel: (modelName) => ipcRenderer.invoke('storage:delete-custom-model', modelName),
  testModelConnection: (model) => ipcRenderer.invoke('storage:test-model-connection', model),
};

const logsAPI: LogsAPI = {
  getElectronLogs: () => ipcRenderer.invoke('logs:electron'),
};

const extensionsAPI: ExtensionsAPI = {
  sendAuthorities: (authoritiesMap) => ipcRenderer.invoke('extensions:send-authorities', authoritiesMap),
};

const deepLinkAPI: DeepLinkAPI = {
  onDeepLink: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, url: string) => {
      callback(url);
    };
    ipcRenderer.on('deep-link', handler);
    return () => {
      ipcRenderer.removeListener('deep-link', handler);
    };
  },
  getStoredDeepLink: () => ipcRenderer.invoke('deep-link:get-stored'),
};

const agentAPI: AgentAPI = {
  updateActiveAgentCount: (count) => ipcRenderer.invoke('agent:update-active-count', count),
};

const electronNativeAPI: ElectronNativeAPI = {
  getZoomLevel: () => webFrame.getZoomFactor(),
  setTitleBarOverlay: (options) => ipcRenderer.invoke('window:set-title-bar-overlay', options),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  unmaximize: () => ipcRenderer.invoke('window:unmaximize'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  close: () => ipcRenderer.invoke('window:close'),
  toggleDevTools: () => ipcRenderer.invoke('window:toggle-devtools'),
  zoomIn: () => {
    const current = webFrame.getZoomLevel();
    webFrame.setZoomLevel(current + 0.5);
  },
  zoomOut: () => {
    const current = webFrame.getZoomLevel();
    webFrame.setZoomLevel(current - 0.5);
  },
  resetZoom: () => {
    webFrame.setZoomLevel(0);
  },
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  revealInFilePicker: (path) => ipcRenderer.invoke('shell:reveal-in-file-picker', path),
};

const ideAPI: IdeAPI = {
  isInstalled: () => ipcRenderer.invoke('ide:is-installed'),
};

// ─── Expose all APIs via contextBridge ──────────────────────────────────────

contextBridge.exposeInMainWorld('electronUpdater', updaterAPI);
contextBridge.exposeInMainWorld('dialog', dialogAPI);
contextBridge.exposeInMainWorld('nativeNotifications', notificationAPI);
contextBridge.exposeInMainWorld('nativeStorage', storageAPI);
contextBridge.exposeInMainWorld('logs', logsAPI);
contextBridge.exposeInMainWorld('extensions', extensionsAPI);
contextBridge.exposeInMainWorld('deepLink', deepLinkAPI);
contextBridge.exposeInMainWorld('agent', agentAPI);
contextBridge.exposeInMainWorld('electronNative', electronNativeAPI);
contextBridge.exposeInMainWorld('ide', ideAPI);

// ─── Renderer Augmentations (for TypeScript global type declarations) ──────

declare global {
  interface Window {
    electronUpdater: UpdaterAPI;
    dialog: DialogAPI;
    nativeNotifications: NotificationAPI;
    nativeStorage: StorageAPI;
    logs: LogsAPI;
    extensions: ExtensionsAPI;
    deepLink: DeepLinkAPI;
    agent: AgentAPI;
    electronNative: ElectronNativeAPI;
    ide: IdeAPI;
  }
}

// ─── Custom Models UI Injection ─────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  function findRefreshButton(): HTMLButtonElement | null {
    const buttons = Array.from(document.querySelectorAll('button'));
    return (buttons.find((b) => b.textContent?.trim() === 'Refresh') as HTMLButtonElement) || null;
  }

  interface McpLayout {
    mainContainer: Node;
    headerRow: Element;
    contentBlock: Element | null;
  }

  function findMcpSectionContainer(): McpLayout | null {
    const refreshBtn = findRefreshButton();
    if (!refreshBtn) return null;

    const btnGroup = refreshBtn.parentNode;
    if (!btnGroup) return null;

    const headerRow = btnGroup.parentNode as Element;
    if (!headerRow) return null;

    const mainContainer = headerRow.parentNode;
    if (!mainContainer) return null;

    const contentBlock = headerRow.nextElementSibling;

    return {
      mainContainer,
      headerRow,
      contentBlock,
    };
  }

  // ─── Provider Icons & Status Helpers ──────────────────────────────
  const PROVIDER_ICONS: Record<string, string> = {
    openai: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M2 17l10 5 10-5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M2 12l10 5 10-5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
    anthropic: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="8" width="4" height="8" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="10" y="5" width="4" height="14" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="17" y="2" width="4" height="20" rx="1" stroke="currentColor" stroke-width="1.5"/></svg>`,
    google: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M12 4a8 8 0 0 1 5.66 13.66L12 12V4z" fill="currentColor" fill-opacity="0.2"/></svg>`,
    ollama: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="10" r="1.5" fill="currentColor"/><circle cx="15" cy="10" r="1.5" fill="currentColor"/><path d="M8 15c1 1.5 3 2 4 2s3-.5 4-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    openrouter: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="12" r="3" fill="currentColor" fill-opacity="0.3"/></svg>`,
    custom: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  };

  const PROVIDER_COLORS: Record<string, string> = {
    openai: '#10a37f',
    anthropic: '#d97757',
    google: '#4285f4',
    ollama: '#f0f0f0',
    openrouter: '#ff7a45',
    custom: '#a855f7',
  };

  function getProviderIcon(provider: string): string {
    return PROVIDER_ICONS[provider] || PROVIDER_ICONS.custom;
  }

  function getProviderColor(provider: string): string {
    return PROVIDER_COLORS[provider] || PROVIDER_COLORS.custom;
  }

  async function renderCustomModelsList(): Promise<void> {
    const contentArea = document.getElementById('agy-custom-models-content');
    if (!contentArea) return;

    contentArea.innerHTML = '';

    try {
      const models = await storageAPI.getCustomModels();
      if (!models || models.length === 0) {
        const placeholder = document.createElement('div');
        placeholder.style.display = 'flex';
        placeholder.style.flexDirection = 'column';
        placeholder.style.alignItems = 'center';
        placeholder.style.justifyContent = 'center';
        placeholder.style.padding = '24px';
        placeholder.style.backgroundColor = '#18181b';
        placeholder.style.border = '1px solid #27272a';
        placeholder.style.borderRadius = '8px';
        placeholder.style.textAlign = 'center';

        placeholder.innerHTML = `
                    <div style="font-size: 15px; font-weight: 600; color: #f4f4f5; margin-bottom: 4px;">No Custom Models</div>
                    <div style="font-size: 13px; color: #a1a1aa;">You currently don't have any custom models installed. Add a custom model above.</div>
                `;
        contentArea.appendChild(placeholder);
      } else {
        models.forEach((model) => {
          const item = document.createElement('div');
          item.style.display = 'flex';
          item.style.justifyContent = 'space-between';
          item.style.alignItems = 'center';
          item.style.padding = '12px 16px';
          item.style.backgroundColor = '#18181b';
          item.style.border = '1px solid #27272a';
          item.style.borderRadius = '8px';
          item.style.transition = 'border-color 0.15s ease, background-color 0.15s ease';
          item.style.marginBottom = '8px';

          item.addEventListener('mouseenter', () => {
            item.style.borderColor = '#3f3f46';
            item.style.backgroundColor = '#1c1c1f';
          });
          item.addEventListener('mouseleave', () => {
            item.style.borderColor = '#27272a';
            item.style.backgroundColor = '#18181b';
          });

          // ─── Left: Provider icon + model info ────────────
          const left = document.createElement('div');
          left.style.display = 'flex';
          left.style.alignItems = 'center';
          left.style.gap = '12px';

          // Provider icon bubble
          const iconWrapper = document.createElement('div');
          iconWrapper.style.width = '32px';
          iconWrapper.style.height = '32px';
          iconWrapper.style.borderRadius = '8px';
          iconWrapper.style.display = 'flex';
          iconWrapper.style.alignItems = 'center';
          iconWrapper.style.justifyContent = 'center';
          iconWrapper.style.backgroundColor = getProviderColor(model.provider as string) + '18';
          iconWrapper.style.color = getProviderColor(model.provider as string);
          iconWrapper.style.flexShrink = '0';
          iconWrapper.innerHTML = getProviderIcon(model.provider as string);

          // Text info
          const info = document.createElement('div');
          info.style.display = 'flex';
          info.style.flexDirection = 'column';
          info.style.gap = '2px';

          // Title row with status dot
          const titleRow = document.createElement('div');
          titleRow.style.display = 'flex';
          titleRow.style.alignItems = 'center';
          titleRow.style.gap = '6px';

          // Status indicator dot
          const statusDot = document.createElement('span');
          statusDot.style.width = '6px';
          statusDot.style.height = '6px';
          statusDot.style.borderRadius = '50%';
          statusDot.style.flexShrink = '0';
          statusDot.style.backgroundColor = '#71717a'; // neutral = unknown
          statusDot.title = 'Connection status unknown (test to verify)';
          statusDot.style.transition = 'background-color 0.3s ease';

          const title = document.createElement('div');
          title.style.fontSize = '14px';
          title.style.fontWeight = '500';
          title.style.color = '#f4f4f5';
          title.textContent = (model.displayName as string) || (model.name as string);

          titleRow.appendChild(statusDot);
          titleRow.appendChild(title);

          // Subtitle with provider badge
          const sub = document.createElement('div');
          sub.style.fontSize = '12px';
          sub.style.color = '#a1a1aa';
          sub.style.display = 'flex';
          sub.style.alignItems = 'center';
          sub.style.gap = '8px';

          // Provider badge
          const badge = document.createElement('span');
          badge.style.fontSize = '10px';
          badge.style.fontWeight = '600';
          badge.style.textTransform = 'uppercase';
          badge.style.letterSpacing = '0.5px';
          badge.style.padding = '2px 6px';
          badge.style.borderRadius = '4px';
          badge.style.backgroundColor = getProviderColor(model.provider as string) + '22';
          badge.style.color = getProviderColor(model.provider as string);
          badge.textContent = model.provider as string;

          sub.appendChild(badge);
          sub.appendChild(document.createTextNode(model.apiUrl as string));

          info.appendChild(titleRow);
          info.appendChild(sub);

          left.appendChild(iconWrapper);
          left.appendChild(info);

          // ─── Right: Action buttons ──────────────────
          const actions = document.createElement('div');
          actions.style.display = 'flex';
          actions.style.gap = '4px';
          actions.style.alignItems = 'center';

          // Test Connection button
          const testBtn = document.createElement('button');
          testBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
          testBtn.style.background = 'transparent';
          testBtn.style.border = 'none';
          testBtn.style.color = '#a1a1aa';
          testBtn.style.cursor = 'pointer';
          testBtn.style.padding = '6px';
          testBtn.style.borderRadius = '4px';
          testBtn.style.display = 'flex';
          testBtn.style.alignItems = 'center';
          testBtn.style.justifyContent = 'center';
          testBtn.style.transition = 'color 0.15s ease, background-color 0.15s ease';
          testBtn.title = 'Test connection';

          testBtn.addEventListener('mouseenter', () => {
            testBtn.style.color = '#22c55e';
            testBtn.style.backgroundColor = 'rgba(34, 197, 94, 0.1)';
          });
          testBtn.addEventListener('mouseleave', () => {
            testBtn.style.color = '#a1a1aa';
            testBtn.style.backgroundColor = 'transparent';
          });

          testBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            // Show loading spinner
            const originalHtml = testBtn.innerHTML;
            testBtn.style.color = '#fbbf24';
            testBtn.style.cursor = 'wait';
            testBtn.disabled = true;
            testBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`;

            try {
              const result = await storageAPI.testModelConnection({
                apiUrl: model.apiUrl as string,
                provider: model.provider as string,
                apiKey: model.apiKey as string,
                allowUnauthorized: model.allowUnauthorized as boolean | undefined,
              });

              if (result.success) {
                statusDot.style.backgroundColor = '#22c55e'; // green
                statusDot.title = result.message || 'Connected';
                testBtn.title = 'Connected ✓';
                testBtn.style.color = '#22c55e';
                testBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
              } else {
                statusDot.style.backgroundColor = '#ef4444'; // red
                const errMsg = result.error || 'Connection failed';
                statusDot.title = errMsg;
                testBtn.title = errMsg;
                testBtn.style.color = '#ef4444';
                testBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
              }
            } catch (err) {
              statusDot.style.backgroundColor = '#ef4444';
              statusDot.title = 'Connection test failed';
              testBtn.title = 'Connection test failed';
              testBtn.style.color = '#ef4444';
              testBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
            }

            testBtn.style.cursor = 'pointer';

            // Reset to neutral after 3 seconds
            setTimeout(() => {
              testBtn.disabled = false;
              testBtn.style.cursor = 'pointer';
              testBtn.style.color = '#a1a1aa';
              testBtn.style.borderColor = '#3f3f46';
              testBtn.innerHTML = originalHtml;
            }, 3000);
          });

          // Delete button
          const deleteBtn = document.createElement('button');
          deleteBtn.innerHTML = `
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            <line x1="10" y1="11" x2="10" y2="17"></line>
                            <line x1="14" y1="11" x2="14" y2="17"></line>
                        </svg>
                    `;
          deleteBtn.style.background = 'transparent';
          deleteBtn.style.border = 'none';
          deleteBtn.style.color = '#a1a1aa';
          deleteBtn.style.cursor = 'pointer';
          deleteBtn.style.padding = '6px';
          deleteBtn.style.borderRadius = '4px';
          deleteBtn.style.display = 'flex';
          deleteBtn.style.alignItems = 'center';
          deleteBtn.style.justifyContent = 'center';
          deleteBtn.style.transition = 'color 0.15s ease, background-color 0.15s ease';

          deleteBtn.addEventListener('mouseenter', () => {
            deleteBtn.style.color = '#ef4444';
            deleteBtn.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
          });
          deleteBtn.addEventListener('mouseleave', () => {
            deleteBtn.style.color = '#a1a1aa';
            deleteBtn.style.backgroundColor = 'transparent';
          });

          deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm(`Are you sure you want to delete the model "${model.displayName || model.name}"?`)) {
              await storageAPI.deleteCustomModel(model.name as string);
              await renderCustomModelsList();

              const refreshBtn = findRefreshButton();
              if (refreshBtn) refreshBtn.click();
            }
          });

          actions.appendChild(testBtn);
          actions.appendChild(deleteBtn);

          item.appendChild(left);
          item.appendChild(actions);
          contentArea.appendChild(item);
        });
      }
    } catch (err) {
      console.error('Failed to load custom models in list:', err);
    }
  }

  async function injectCustomModelsSection(): Promise<void> {
    const layout = findMcpSectionContainer();
    if (!layout) return;

    const { mainContainer, headerRow, contentBlock } = layout;

    if (document.getElementById('agy-custom-models-section')) return;

    const section = document.createElement('div');
    section.id = 'agy-custom-models-section';
    section.style.marginTop = '24px';
    section.style.display = 'flex';
    section.style.flexDirection = 'column';
    section.style.gap = '12px';

    const newHeaderRow = document.createElement('div');
    newHeaderRow.className = (headerRow as HTMLElement).className;
    newHeaderRow.style.cssText = (headerRow as HTMLElement).style.cssText;
    newHeaderRow.style.display = 'flex';
    newHeaderRow.style.justifyContent = 'space-between';
    newHeaderRow.style.alignItems = 'center';
    newHeaderRow.style.marginBottom = '8px';

    const originalHeading = headerRow.firstElementChild as HTMLElement;
    const newHeading = document.createElement(originalHeading ? originalHeading.tagName : 'div');
    if (originalHeading) {
      newHeading.className = originalHeading.className;
      newHeading.style.cssText = originalHeading.style.cssText;
    }
    newHeading.textContent = 'Custom Models';

    const newBtnGroup = document.createElement('div');
    const originalBtnGroup = headerRow.lastElementChild as HTMLElement;
    if (originalBtnGroup) {
      newBtnGroup.className = originalBtnGroup.className;
      newBtnGroup.style.cssText = originalBtnGroup.style.cssText;
    }
    newBtnGroup.style.display = 'flex';
    newBtnGroup.style.gap = '8px';
    newBtnGroup.style.alignItems = 'center';

    const addModelBtn = document.createElement('button');
    addModelBtn.id = 'agy-add-model-btn';
    addModelBtn.textContent = 'Add Model';
    const refreshBtn = findRefreshButton();
    if (refreshBtn) {
      addModelBtn.className = refreshBtn.className;
      addModelBtn.style.cssText = refreshBtn.style.cssText;
    }
    addModelBtn.style.cursor = 'pointer';
    addModelBtn.addEventListener('click', () => {
      openAddModelModal();
    });

    newBtnGroup.appendChild(addModelBtn);
    newHeaderRow.appendChild(newHeading);
    newHeaderRow.appendChild(newBtnGroup);

    const contentArea = document.createElement('div');
    contentArea.id = 'agy-custom-models-content';
    contentArea.style.display = 'flex';
    contentArea.style.flexDirection = 'column';
    contentArea.style.gap = '8px';

    section.appendChild(newHeaderRow);
    section.appendChild(contentArea);

    if (contentBlock && contentBlock.nextSibling) {
      mainContainer.insertBefore(section, contentBlock.nextSibling);
    } else {
      mainContainer.appendChild(section);
    }

    await renderCustomModelsList();
  }

  function openAddModelModal(): void {
    // Remove existing modal if any
    const existing = document.getElementById('agy-modal-overlay');
    if (existing) existing.remove();

    // Modal overlay backdrop
    const overlay = document.createElement('div');
    overlay.id = 'agy-modal-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
    overlay.style.backdropFilter = 'blur(6px)';
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    overlay.style.zIndex = '999999';
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.2s ease-in-out';

    // Modal card container
    const modal = document.createElement('div');
    modal.id = 'agy-modal-card';
    modal.style.width = '520px';
    modal.style.maxHeight = '90vh';
    modal.style.overflowY = 'auto';
    modal.style.backgroundColor = '#18181b';
    modal.style.border = '1px solid #27272a';
    modal.style.borderRadius = '16px';
    modal.style.padding = '32px';
    modal.style.boxShadow = '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.5)';
    modal.style.color = '#f4f4f5';
    modal.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    modal.style.transform = 'scale(0.9) translateY(20px)';
    modal.style.transition = 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)';

    modal.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div id="agy-modal-provider-icon" style="width: 28px; height: 28px; border-radius: 7px; display: flex; align-items: center; justify-content: center; background-color: #10a37f18; color: #10a37f;">${PROVIDER_ICONS.openai}</div>
                    <h3 style="margin: 0; font-size: 20px; font-weight: 600; color: #f4f4f5;">Add Custom AI Model</h3>
                </div>
                <button id="agy-modal-close" style="background: transparent; border: none; color: #a1a1aa; cursor: pointer; font-size: 20px; line-height: 1; padding: 4px; display: flex; align-items: center; justify-content: center; transition: color 0.15s ease;">&times;</button>
            </div>

            <div style="display: flex; flex-direction: column; gap: 16px; margin-bottom: 24px;">
                <!-- Provider -->
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <label style="font-size: 13px; font-weight: 500; color: #a1a1aa;">API Provider</label>
                    <select id="agy-provider" style="background-color: #27272a; border: 1px solid #3f3f46; border-radius: 8px; color: #f4f4f5; padding: 10px 12px; font-size: 14px; outline: none; cursor: pointer; transition: border-color 0.15s ease;">
                        <option value="openai">OpenAI (ChatGPT)</option>
                        <option value="anthropic">Anthropic (Claude)</option>
                        <option value="google">Google AI Studio (Gemini)</option>
                        <option value="ollama">Ollama (Local)</option>
                        <option value="openrouter">OpenRouter</option>
                        <option value="deepseek">DeepSeek</option>
                        <option value="groq">Groq</option>
                        <option value="mistral">Mistral</option>
                        <option value="cerebras">Cerebras</option>
                        <option value="kimi">Kimi (Moonshot)</option>
                        <option value="fireworks">Fireworks AI</option>
                        <option value="lmstudio">LM Studio (Local)</option>
                        <option value="llamacpp">llama.cpp (Local)</option>
                        <option value="nvidia">NVIDIA NIM</option>
                        <option value="custom">Custom / Other</option>
                    </select>
                </div>

                <!-- Model ID -->
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <label style="font-size: 13px; font-weight: 500; color: #a1a1aa;">Model Name / ID <span style="color: #ef4444;">*</span></label>
                    <input type="text" id="agy-model-id" placeholder="e.g. gpt-4o" style="background-color: #27272a; border: 1px solid #3f3f46; border-radius: 8px; color: #f4f4f5; padding: 10px 12px; font-size: 14px; outline: none; transition: border-color 0.15s ease;" required />
                    <div id="agy-model-id-error" style="font-size: 11px; color: #ef4444; display: none; margin-top: 2px;"></div>
                </div>

                <!-- Friendly Display Name -->
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <label style="font-size: 13px; font-weight: 500; color: #a1a1aa;">Friendly Display Name</label>
                    <input type="text" id="agy-display-name" placeholder="e.g. GPT-4o (OpenAI)" style="background-color: #27272a; border: 1px solid #3f3f46; border-radius: 8px; color: #f4f4f5; padding: 10px 12px; font-size: 14px; outline: none; transition: border-color 0.15s ease;" />
                </div>

                <!-- API Key -->
                <div id="agy-key-container" style="display: flex; flex-direction: column; gap: 6px;">
                    <label style="font-size: 13px; font-weight: 500; color: #a1a1aa;">API Key <span id="agy-key-required" style="color: #ef4444;">*</span></label>
                    <input type="password" id="agy-api-key" placeholder="Enter API key" style="background-color: #27272a; border: 1px solid #3f3f46; border-radius: 8px; color: #f4f4f5; padding: 10px 12px; font-size: 14px; outline: none; transition: border-color 0.15s ease;" />
                </div>

                <!-- API URL -->
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <label style="font-size: 13px; font-weight: 500; color: #a1a1aa;">API URL <span style="color: #ef4444;">*</span></label>
                    <div style="display: flex; gap: 6px; align-items: center;">
                        <input type="text" id="agy-api-url" placeholder="https://api.openai.com/v1/chat/completions" style="flex: 1; background-color: #27272a; border: 1px solid #3f3f46; border-radius: 8px; color: #f4f4f5; padding: 10px 12px; font-size: 14px; outline: none; transition: border-color 0.15s ease;" required />
                        <div id="agy-url-status" style="width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background-color: #71717a; transition: background-color 0.3s ease;" title="URL not yet validated"></div>
                    </div>
                    <div id="agy-url-error" style="font-size: 11px; color: #ef4444; display: none; margin-top: 2px;"></div>
                </div>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center;">
                <button id="agy-btn-test" style="background-color: transparent; border: 1px solid #3f3f46; border-radius: 8px; color: #a1a1aa; padding: 10px 14px; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.15s ease; display: flex; align-items: center; gap: 6px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    Test Connection
                </button>
                <div style="display: flex; gap: 12px;">
                    <button id="agy-btn-cancel" style="background-color: #27272a; border: 1px solid #3f3f46; border-radius: 8px; color: #e4e4e7; padding: 10px 18px; font-size: 14px; font-weight: 500; cursor: pointer; transition: background-color 0.15s ease, color 0.15s ease;">Cancel</button>
                    <button id="agy-btn-save" style="background-color: #e4e4e7; border: none; border-radius: 8px; color: #18181b; padding: 10px 22px; font-size: 14px; font-weight: 500; cursor: pointer; transition: background-color 0.15s ease, opacity 0.15s ease;">Save Model</button>
                </div>
            </div>
        `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Animate in
    setTimeout(() => {
      overlay.style.opacity = '1';
      modal.style.transform = 'scale(1) translateY(0)';
    }, 10);

    // Close handler
    const closeModal = () => {
      overlay.style.opacity = '0';
      modal.style.transform = 'scale(0.9) translateY(20px)';
      setTimeout(() => overlay.remove(), 200);
    };

    document.getElementById('agy-modal-close')!.addEventListener('click', closeModal);
    document.getElementById('agy-btn-cancel')!.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    const providerSelect = document.getElementById('agy-provider') as HTMLSelectElement;
    const urlInput = document.getElementById('agy-api-url') as HTMLInputElement;
    const keyContainer = document.getElementById('agy-key-container')!;
    const keyInput = document.getElementById('agy-api-key') as HTMLInputElement;
    const modelInput = document.getElementById('agy-model-id') as HTMLInputElement;
    const nameInput = document.getElementById('agy-display-name') as HTMLInputElement;
    const urlStatus = document.getElementById('agy-url-status')!;
    const urlError = document.getElementById('agy-url-error')!;
    const modelIdError = document.getElementById('agy-model-id-error')!;
    const providerIcon = document.getElementById('agy-modal-provider-icon')!;
    const keyRequired = document.getElementById('agy-key-required')!;
    const testBtn = document.getElementById('agy-btn-test') as HTMLButtonElement;
    const saveBtn = document.getElementById('agy-btn-save') as HTMLButtonElement;

    const prefilledUrls: Record<string, string> = {
      openai: 'https://api.openai.com/v1/chat/completions',
      anthropic: 'https://api.anthropic.com/v1/messages',
      ollama: 'http://localhost:11434/v1/chat/completions',
      openrouter: 'https://openrouter.ai/api/v1/chat/completions',
      deepseek: 'https://api.deepseek.com/anthropic',
      groq: 'https://api.groq.com/openai/v1',
      mistral: 'https://api.mistral.ai/v1',
      cerebras: 'https://api.cerebras.ai/v1',
      kimi: 'https://api.moonshot.ai/anthropic/v1',
      fireworks: 'https://api.fireworks.ai/inference/v1',
      lmstudio: 'http://localhost:1234/v1',
      llamacpp: 'http://localhost:8080/v1',
      nvidia: 'https://integrate.api.nvidia.com/v1',
      custom: '',
    };

    // Real-time URL validation
    const validateUrl = () => {
      const val = urlInput.value.trim();
      if (!val) {
        urlStatus.style.backgroundColor = '#71717a';
        urlStatus.title = 'URL required';
        return;
      }
      try {
        const u = new URL(val);
        if (['http:', 'https:'].includes(u.protocol)) {
          urlStatus.style.backgroundColor = '#22c55e';
          urlStatus.title = 'Valid URL format';
          urlError.style.display = 'none';
        } else {
          urlStatus.style.backgroundColor = '#fbbf24';
          urlStatus.title = 'URL must use http or https';
        }
      } catch {
        urlStatus.style.backgroundColor = '#ef4444';
        urlStatus.title = 'Invalid URL format';
        urlError.textContent = 'Please enter a valid URL (e.g. https://api.openai.com/v1)';
        urlError.style.display = 'block';
      }
    };

    // Model ID validation
    const validateModelId = () => {
      const val = modelInput.value.trim();
      if (val && !/^[a-zA-Z0-9._/-]+$/.test(val)) {
        modelIdError.textContent = 'Use only letters, numbers, dots, hyphens, underscores, forward slashes';
        modelIdError.style.display = 'block';
        modelInput.style.borderColor = '#ef4444';
      } else {
        modelIdError.style.display = 'none';
        modelInput.style.borderColor = '#3f3f46';
      }
    };

    urlInput.addEventListener('input', validateUrl);
    modelInput.addEventListener('input', () => {
      validateModelId();
      if (providerSelect.value === 'google') {
        const modelId = modelInput.value.trim() || 'model-name';
        urlInput.value = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
        validateUrl();
      }
    });

    const updatePrefills = () => {
      const val = providerSelect.value;
      const modelId = modelInput.value.trim() || 'model-name';

      if (val === 'google') {
        urlInput.value = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
      } else {
        urlInput.value = prefilledUrls[val] || '';
      }

      // Update provider icon
      providerIcon.style.backgroundColor = getProviderColor(val) + '18';
      providerIcon.style.color = getProviderColor(val);
      providerIcon.innerHTML = getProviderIcon(val);

      // Update key requirement indicator
      if (val === 'ollama') {
        keyContainer.style.display = 'none';
        keyInput.value = '';
        keyRequired.style.display = 'none';
        modelInput.placeholder = 'e.g. llama3';
        nameInput.placeholder = 'e.g. Llama 3 (Ollama)';
      } else {
        keyContainer.style.display = 'flex';
        keyRequired.style.display = 'inline';
        if (val === 'openai') {
          modelInput.placeholder = 'e.g. gpt-4o';
          nameInput.placeholder = 'e.g. GPT-4o (OpenAI)';
        } else if (val === 'anthropic') {
          modelInput.placeholder = 'e.g. claude-3-5-sonnet-latest';
          nameInput.placeholder = 'e.g. Claude 3.5 Sonnet';
        } else if (val === 'google') {
          modelInput.placeholder = 'e.g. gemini-2.0-flash';
          nameInput.placeholder = 'e.g. Gemini 2.0 Flash';
        } else {
          modelInput.placeholder = 'e.g. model-name';
          nameInput.placeholder = 'e.g. My Custom Model';
        }
      }

      validateUrl();
    };

    providerSelect.addEventListener('change', updatePrefills);

    // ─── Test Connection in Modal ────────────────────
    testBtn.addEventListener('click', async () => {
      const provider = providerSelect.value;
      const modelId = modelInput.value.trim();
      const apiKey = keyInput.value.trim();
      const apiUrl = urlInput.value.trim();

      if (!apiUrl) {
        alert('Please enter an API URL first');
        return;
      }

      testBtn.disabled = true;
      testBtn.style.cursor = 'wait';
      testBtn.style.color = '#fbbf24';
      testBtn.style.borderColor = '#fbbf24';
      const originalHtml = testBtn.innerHTML;
      testBtn.innerHTML = '<span>Testing...</span>';

      try {
        const result = await storageAPI.testModelConnection({
          apiUrl,
          provider,
          apiKey,
        });

        if (result.success) {
          urlStatus.style.backgroundColor = '#22c55e';
          urlStatus.title = result.message || 'Connection successful!';
          testBtn.style.color = '#22c55e';
          testBtn.style.borderColor = '#22c55e';
        } else {
          urlStatus.style.backgroundColor = '#ef4444';
          urlStatus.title = result.error || 'Connection failed';
          testBtn.style.color = '#ef4444';
          testBtn.style.borderColor = '#ef4444';
        }
      } catch (err) {
        urlStatus.style.backgroundColor = '#ef4444';
        urlStatus.title = 'Test connection failed';
        testBtn.style.color = '#ef4444';
        testBtn.style.borderColor = '#ef4444';
      }

      setTimeout(() => {
        testBtn.disabled = false;
        testBtn.style.cursor = 'pointer';
        testBtn.style.color = '#a1a1aa';
        testBtn.style.borderColor = '#3f3f46';
        testBtn.innerHTML = originalHtml;
      }, 3000);
    });

    saveBtn.addEventListener('click', async () => {
      const provider = providerSelect.value;
      const modelId = modelInput.value.trim();
      let displayName = nameInput.value.trim();
      const apiKey = keyInput.value.trim();
      const apiUrl = urlInput.value.trim();

      // Clear previous errors
      modelIdError.style.display = 'none';
      urlError.style.display = 'none';
      modelInput.style.borderColor = '#3f3f46';
      urlInput.style.borderColor = '#3f3f46';

      let hasError = false;

      if (!modelId) {
        modelIdError.textContent = 'Model ID is required';
        modelIdError.style.display = 'block';
        modelInput.style.borderColor = '#ef4444';
        hasError = true;
      } else if (!/^[a-zA-Z0-9._/-]+$/.test(modelId)) {
        modelIdError.textContent = 'Use only letters, numbers, dots, hyphens, underscores, forward slashes';
        modelIdError.style.display = 'block';
        modelInput.style.borderColor = '#ef4444';
        hasError = true;
      }

      if (provider !== 'ollama' && !apiKey) {
        alert('API Key is required.');
        hasError = true;
      }

      if (!apiUrl) {
        urlError.textContent = 'API URL is required';
        urlError.style.display = 'block';
        urlInput.style.borderColor = '#ef4444';
        hasError = true;
      } else {
        try {
          const u = new URL(apiUrl);
          if (!['http:', 'https:'].includes(u.protocol)) {
            urlError.textContent = 'URL must start with http:// or https://';
            urlError.style.display = 'block';
            urlInput.style.borderColor = '#ef4444';
            hasError = true;
          }
        } catch {
          urlError.textContent = 'Invalid URL format';
          urlError.style.display = 'block';
          urlInput.style.borderColor = '#ef4444';
          hasError = true;
        }
      }

      if (hasError) return;

      if (!displayName) {
        const providerNames: Record<string, string> = {
          openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google Studio',
          ollama: 'Ollama', openrouter: 'OpenRouter', custom: 'Custom',
          deepseek: 'DeepSeek', groq: 'Groq', mistral: 'Mistral',
          cerebras: 'Cerebras', kimi: 'Kimi', fireworks: 'Fireworks',
          lmstudio: 'LM Studio', llamacpp: 'llama.cpp', nvidia: 'NVIDIA',
        };
        displayName = `${modelId} (${providerNames[provider]})`;
      }

      const newModel: CustomModelEntry = {
        name: 'models/' + modelId,
        displayName: displayName,
        description: `${displayName} custom model redirected through local proxy`,
        provider: provider,
        apiKey: apiKey || 'none',
        apiUrl: apiUrl,
        externalModelName: modelId,
      };

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      try {
        const res = await storageAPI.saveCustomModel(newModel);
        if (res && res.success) {
          closeModal();

          // Re-render the custom models list immediately!
          await renderCustomModelsList();

          // Trigger native refresh button if available
          const refreshBtn = findRefreshButton();
          if (refreshBtn) {
            refreshBtn.click();
          }
        } else {
          alert('Failed to save model: ' + (res?.error || 'Unknown error'));
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Model';
        }
      } catch (err) {
        alert('Error saving model: ' + (err as Error).message);
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Model';
      }
    });
  }

  // ─── Real-Time Bidirectional Voice Interface & Live Debug Console ─────────
  function setupVoiceInterface(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (!document.createElement || !document.body) return;
    if (document.getElementById('agy-voice-container')) return;

    // 1. Inject Styles
    const style = document.createElement('style');
    style.id = 'agy-voice-styles';
    style.textContent = `
      #agy-voice-container {
        position: fixed;
        bottom: 22px;
        right: 22px;
        z-index: 999999;
        display: flex;
        align-items: center;
        gap: 8px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      #agy-voice-btn {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: rgba(26, 27, 30, 0.9);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.16);
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        user-select: none;
        color: #94a3b8;
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      }
      #agy-voice-btn:hover {
        transform: scale(1.08);
        color: #f8fafc;
        border-color: rgba(255, 255, 255, 0.3);
        box-shadow: 0 6px 24px rgba(0, 0, 0, 0.55);
      }
      #agy-voice-btn.connecting {
        color: #f59e0b;
        border-color: rgba(245, 158, 11, 0.7);
        box-shadow: 0 0 18px rgba(245, 158, 11, 0.5);
        animation: agy-pulse 1.4s infinite ease-in-out;
      }
      #agy-voice-btn.listening {
        color: #38bdf8;
        background: rgba(15, 23, 42, 0.95);
        border-color: rgba(56, 189, 248, 0.8);
        box-shadow: 0 0 22px rgba(56, 189, 248, 0.6);
      }
      #agy-voice-btn.speaking {
        color: #c084fc;
        background: rgba(24, 16, 42, 0.95);
        border-color: rgba(192, 132, 252, 0.8);
        box-shadow: 0 0 26px rgba(192, 132, 252, 0.75);
        animation: agy-speaking 0.9s infinite alternate ease-in-out;
      }
      #agy-voice-btn.error {
        color: #ef4444;
        border-color: rgba(239, 68, 68, 0.8);
        box-shadow: 0 0 20px rgba(239, 68, 68, 0.6);
        background: rgba(40, 10, 15, 0.95);
      }
      #agy-voice-console-btn {
        width: 34px;
        height: 34px;
        border-radius: 50%;
        background: rgba(26, 27, 30, 0.85);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 3px 12px rgba(0, 0, 0, 0.35);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        user-select: none;
        color: #71717a;
        transition: all 0.2s ease;
      }
      #agy-voice-console-btn:hover {
        color: #38bdf8;
        border-color: rgba(56, 189, 248, 0.4);
        transform: scale(1.08);
      }
      #agy-voice-badge {
        display: none;
        padding: 5px 12px;
        font-size: 11px;
        font-weight: 500;
        color: #f1f5f9;
        background: rgba(15, 23, 42, 0.95);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 12px;
        backdrop-filter: blur(16px);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        white-space: nowrap;
        pointer-events: auto;
        cursor: pointer;
      }
      #agy-voice-console-drawer {
        position: fixed;
        bottom: 76px;
        right: 22px;
        width: 520px;
        height: 520px;
        max-height: calc(100vh - 100px);
        max-width: calc(100vw - 44px);
        border-radius: 14px;
        background: rgba(13, 15, 22, 0.97);
        backdrop-filter: blur(28px);
        -webkit-backdrop-filter: blur(28px);
        border: 1px solid rgba(255, 255, 255, 0.14);
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7);
        display: none;
        flex-direction: column;
        overflow: hidden;
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #e2e8f0;
      }
      .agy-console-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        background: rgba(255, 255, 255, 0.03);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      .agy-console-title {
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.5px;
        display: flex;
        align-items: center;
        gap: 8px;
        color: #f8fafc;
      }
      .agy-console-status-pill {
        font-size: 10px;
        padding: 2px 7px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.1);
        font-weight: 500;
      }
      .agy-console-status-pill.listening { background: rgba(56, 189, 248, 0.2); color: #38bdf8; }
      .agy-console-status-pill.speaking { background: rgba(192, 132, 252, 0.2); color: #c084fc; }
      .agy-console-status-pill.error { background: rgba(239, 68, 68, 0.2); color: #ef4444; }
      .agy-console-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        background: rgba(0, 0, 0, 0.2);
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        flex-wrap: wrap;
      }
      .agy-btn-action {
        font-size: 11px;
        padding: 4px 9px;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.06);
        color: #cbd5e1;
        cursor: pointer;
        transition: all 0.15s;
        user-select: none;
      }
      .agy-btn-action:hover {
        background: rgba(255, 255, 255, 0.12);
        color: #ffffff;
      }
      .agy-btn-action.highlight {
        background: rgba(56, 189, 248, 0.2);
        border-color: rgba(56, 189, 248, 0.4);
        color: #38bdf8;
      }
      .agy-config-box {
        padding: 8px 12px;
        background: rgba(0, 0, 0, 0.3);
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .agy-config-input-row {
        display: flex;
        gap: 6px;
      }
      .agy-config-input {
        flex: 1;
        background: rgba(0, 0, 0, 0.4);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 6px;
        padding: 5px 8px;
        font-size: 11px;
        color: #f1f5f9;
        font-family: monospace;
      }
      .agy-config-input:focus {
        outline: none;
        border-color: #38bdf8;
      }
      .agy-mic-meter-box {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 10px;
        color: #94a3b8;
      }
      .agy-meter-outer {
        flex: 1;
        height: 6px;
        background: rgba(255, 255, 255, 0.08);
        border-radius: 3px;
        overflow: hidden;
      }
      .agy-meter-inner {
        height: 100%;
        width: 0%;
        background: linear-gradient(90deg, #10b981, #38bdf8, #f59e0b, #ef4444);
        transition: width 0.05s ease;
      }
      .agy-logs-window {
        flex: 1;
        padding: 10px 12px;
        background: #090a0f;
        overflow-y: auto;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 11px;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .agy-log-line { margin-bottom: 4px; }
      .agy-log-ts { color: #64748b; margin-right: 6px; }
      .agy-tag-info { color: #94a3b8; font-weight: 600; }
      .agy-tag-mic { color: #38bdf8; font-weight: 600; }
      .agy-tag-ws { color: #818cf8; font-weight: 600; }
      .agy-tag-vad { color: #f59e0b; font-weight: 600; }
      .agy-tag-error { color: #ef4444; font-weight: 700; }
      .agy-tag-success { color: #10b981; font-weight: 600; }
      .agy-tag-model { color: #c084fc; font-weight: 600; }
      @keyframes agy-pulse {
        0% { transform: scale(1); opacity: 0.85; }
        50% { transform: scale(1.08); opacity: 1; }
        100% { transform: scale(1); opacity: 0.85; }
      }
      @keyframes agy-speaking {
        0% { transform: scale(1); box-shadow: 0 0 16px rgba(192, 132, 252, 0.4); }
        100% { transform: scale(1.07); box-shadow: 0 0 28px rgba(192, 132, 252, 0.85); }
      }
    `;
    if (document.head) document.head.appendChild(style);

    // 2. Create Floating Elements
    const container = document.createElement('div');
    container.id = 'agy-voice-container';

    const badge = document.createElement('div');
    badge.id = 'agy-voice-badge';
    badge.textContent = 'Gemini Live (Cmd+Shift+V)';

    const consoleBtn = document.createElement('div');
    consoleBtn.id = 'agy-voice-console-btn';
    consoleBtn.title = 'Live Voice Debug Console (Cmd+Shift+D)';
    consoleBtn.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="4 17 10 11 4 5"></polyline>
        <line x1="12" y1="19" x2="20" y2="19"></line>
      </svg>
    `;

    const micBtn = document.createElement('div');
    micBtn.id = 'agy-voice-btn';
    micBtn.title = 'Talk with Gemini Live (Cmd+Shift+V)';
    micBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
        <line x1="12" y1="19" x2="12" y2="22"></line>
      </svg>
    `;

    container.appendChild(badge);
    container.appendChild(consoleBtn);
    container.appendChild(micBtn);
    document.body.appendChild(container);

    // 3. Create Live Debug Console Drawer
    const drawer = document.createElement('div');
    drawer.id = 'agy-voice-console-drawer';
    drawer.innerHTML = `
      <div class="agy-console-header">
        <div class="agy-console-title">
          <span>🎙️ Gemini Live (Native Neural Voice)</span>
          <span id="agy-console-status" class="agy-console-status-pill">Idle</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <button id="agy-btn-devtools" class="agy-btn-action" title="Open Chrome DevTools">Inspect</button>
          <button id="agy-btn-close-console" class="agy-btn-action" style="padding:2px 7px;">✕</button>
        </div>
      </div>
      <div class="agy-console-actions">
        <button id="agy-btn-test-mic" class="agy-btn-action highlight">Test Mic (5s)</button>
        <button id="agy-btn-test-gw" class="agy-btn-action">Test Live Service</button>
        <button id="agy-btn-copy-logs" class="agy-btn-action">Copy Logs</button>
        <button id="agy-btn-clear-logs" class="agy-btn-action">Clear</button>
      </div>
      <div class="agy-config-box">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;font-size:12px;">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input type="checkbox" id="agy-toggle-wakeword" style="cursor:pointer;" />
            <span><strong>Hands-Free Wake Word</strong> (Experimental - Off)</span>
          </label>
          <span id="agy-wakeword-status" style="font-size:11px;color:#9ca3af;">Disabled</span>
        </div>
        <div class="agy-mic-meter-box">
          <span>Mic Volume:</span>
          <div class="agy-meter-outer"><div id="agy-mic-meter-inner" class="agy-meter-inner"></div></div>
          <span id="agy-meter-val">0%</span>
        </div>
        <div class="agy-config-input-row" style="margin-top:4px;">
          <input id="agy-service-url-input" class="agy-config-input" style="flex:1;" placeholder="ws://127.0.0.1:8000/ws" value="ws://127.0.0.1:8000/ws" />
          <button id="agy-btn-save-config" class="agy-btn-action highlight">Save & Reconnect</button>
        </div>
      </div>
      <div id="agy-console-logs-window" class="agy-logs-window"></div>
    `;
    document.body.appendChild(drawer);

    const logsWindow = drawer.querySelector('#agy-console-logs-window') as HTMLDivElement;
    const statusPill = drawer.querySelector('#agy-console-status') as HTMLSpanElement;
    const meterInner = drawer.querySelector('#agy-mic-meter-inner') as HTMLDivElement;
    const meterVal = drawer.querySelector('#agy-meter-val') as HTMLSpanElement;
    const serviceUrlInput = drawer.querySelector('#agy-service-url-input') as HTMLInputElement;
    const wakeWordToggle = drawer.querySelector('#agy-toggle-wakeword') as HTMLInputElement;
    const wakeWordStatus = drawer.querySelector('#agy-wakeword-status') as HTMLSpanElement;

    // Restore cached service URL
    try {
      const savedUrl = localStorage.getItem('agy_voice_service_url');
      if (savedUrl && serviceUrlInput) serviceUrlInput.value = savedUrl;
    } catch (_) {}

    // Internal Logging
    const rawLogs: string[] = [];
    function logMsg(category: string, text: string, level: 'info' | 'mic' | 'ws' | 'vad' | 'error' | 'success' | 'model' | 'warn' = 'info', isHtml: boolean = false) {
      const d = new Date();
      const ts = d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0');
      const cleanLine = `[${ts}] [${category}] ${text}`;
      rawLogs.push(cleanLine);
      if (rawLogs.length > 300) rawLogs.shift();

      if (logsWindow) {
        const line = document.createElement('div');
        line.className = 'agy-log-line';
        const formattedContent = isHtml ? text : escapeHtml(text);
        line.innerHTML = `<span class="agy-log-ts">[${ts}]</span> <span class="agy-tag-${level}">[${category}]</span> <span>${formattedContent}</span>`;
        logsWindow.appendChild(line);
        logsWindow.scrollTop = logsWindow.scrollHeight;
      }
      console.log(`[Voice][${category}]`, text);
    }

    function escapeHtml(s: string): string {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ─── Antigravity Chat Watcher & Butler Integration ───────────────────────

    let lastSummarizedHash = '';
    let wasGenerating = false;

    function renderTranscriptLine(speaker: 'User' | 'Gemini', text: string) {
      logMsg(speaker.toUpperCase(), text, speaker === 'User' ? 'mic' : 'model');
    }

    // Detects active conversation UUID to pin Butler exclusively to this chat
    function getActiveConversationId(): string | null {
      // 1. Antigravity main conversation view container
      try {
        const viewEl = document.querySelector('[data-testid="conversation-view"][data-cascade-id]');
        if (viewEl) {
          const id = viewEl.getAttribute('data-cascade-id');
          if (id && /^[0-9a-f-]{36}$/i.test(id)) return id;
        }
      } catch (_) {}

      // 2. Active sidebar conversation row
      try {
        const selectedRow = document.querySelector('[data-testid="conversation-row-sidebar"][data-selected="true"], [data-selected="true"][data-cascade-id]');
        if (selectedRow) {
          const id = selectedRow.getAttribute('data-cascade-id');
          if (id && /^[0-9a-f-]{36}$/i.test(id)) return id;
        }
      } catch (_) {}

      // 3. URL params or path match
      try {
        const params = new URLSearchParams(window.location.search);
        const id = params.get('conversation_id') || params.get('conversationId') || params.get('id');
        if (id && /^[0-9a-f-]{36}$/i.test(id)) return id;
      } catch (_) {}

      try {
        const match = (window.location.pathname + window.location.hash).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        if (match) return match[0];
      } catch (_) {}

      try {
        const activeLink = document.querySelector('a[href*="/c/"][aria-current], a[href*="/c/"].active, .active a[href*="/c/"]');
        if (activeLink) {
          const m = activeLink.getAttribute('href')?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
          if (m) return m[0];
        }
      } catch (_) {}

      try {
        const el = document.querySelector('[data-conversation-id], [data-session-id], [data-chat-id]');
        if (el) {
          const id = el.getAttribute('data-conversation-id') || el.getAttribute('data-session-id') || el.getAttribute('data-chat-id');
          if (id && /^[0-9a-f-]{36}$/i.test(id)) return id;
        }
      } catch (_) {}

      return null;
    }

    // Scrapes visible on-screen chat context from Antigravity IDE
    function getVisibleChatHistory(): string {
      const items: { role: string; text: string }[] = [];

      // 1. Query structured chat containers
      const chatRows = document.querySelectorAll(
        '.interactive-item-container, .chat-item, .chat-row, .interactive-session .monaco-list-row, [data-role="user"], [data-role="assistant"], [data-role="model"]'
      );

      if (chatRows.length > 0) {
        chatRows.forEach((row) => {
          const el = row as HTMLElement;
          const isUser =
            el.matches('[data-role="user"], .interactive-request, .chat-request, .user-prompt') ||
            el.querySelector('.interactive-request, .chat-request, .user-prompt, [data-role="user"]') !== null ||
            (el.className && typeof el.className === 'string' && /request|user/i.test(el.className));

          const role = isUser ? 'User' : 'Antigravity Agent';
          const textEl = el.querySelector('.rendered-markdown, .interactive-item-view, .chat-message-content') || el;
          let text = (textEl.textContent || '').trim();
          if (text) {
            text = text.replace(/```[\s\S]*?```/g, '[code snippet]').replace(/\s+/g, ' ').slice(0, 500);
            if (text.length > 5) {
              items.push({ role, text });
            }
          }
        });
      }

      // 2. Fallback: query markdown blocks if specific rows aren't separated
      if (items.length === 0) {
        const markdowns = document.querySelectorAll('.rendered-markdown');
        markdowns.forEach((md, idx) => {
          let text = (md.textContent || '').trim();
          if (text) {
            text = text.replace(/```[\s\S]*?```/g, '[code snippet]').replace(/\s+/g, ' ').slice(0, 500);
            if (text.length > 5) {
              items.push({ role: idx % 2 === 0 ? 'User' : 'Antigravity Agent', text });
            }
          }
        });
      }

      if (items.length === 0) return '';
      const recent = items.slice(-6);
      return recent.map((item) => `${item.role}: ${item.text}`).join('\n');
    }

    function setupChatResponseWatcher() {
      const observer = new MutationObserver(() => {
        const stopBtn = document.querySelector('button[aria-label*="Stop"], button[aria-label*="Cancel"], .codicon-stop-circle, .interactive-progress');
        const isGenerating = Boolean(stopBtn);

        if (isGenerating) {
          wasGenerating = true;
          return;
        }

        if (wasGenerating && !isGenerating) {
          wasGenerating = false;
          handleAgentResponseComplete();
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
    }

    function handleAgentResponseComplete() {
      const responses = document.querySelectorAll('.interactive-item-container .rendered-markdown, .chat-response .rendered-markdown, .rendered-markdown');
      if (!responses || responses.length === 0) return;

      const latest = responses[responses.length - 1] as HTMLElement;
      const rawText = (latest.innerText || latest.textContent || '').trim();
      if (!rawText || rawText.length < 15) return;

      const hash = rawText.slice(0, 120) + rawText.length;
      if (hash === lastSummarizedHash) return;
      lastSummarizedHash = hash;

      logMsg('AGENT', `Antigravity agent finished response (${rawText.length} chars).`, 'info');

      // Funnel to Butler if voice session is active
      if (ws && ws.readyState === WebSocket.OPEN) {
        const cleanText = rawText.replace(/```[\s\S]*?```/g, '[code block]').slice(0, 1200);
        const funnelMessage = `[SYSTEM EVENT: The Antigravity coding agent just finished executing. Here is what was produced: "${cleanText}". As the pair-programming Butler, speak out loud to the user in 1-2 casual, friendly, spoken conversational sentences (ELI5) summarizing what was accomplished. Then ask the user if they want to review it or move to the next task.]`;

        ws.send(JSON.stringify({ text: funnelMessage }));
        logMsg('BUTLER', 'Funneled response to Butler for casual spoken ELI5 summary.', 'success');
      }
    }

    setupChatResponseWatcher();

    logMsg('INIT', 'Gemini Live Voice Client & Butler loop initialized.', 'info');

    // Drawer toggle
    function toggleDrawer(forceOpen?: boolean) {
      const isOpen = drawer.style.display === 'flex';
      const next = forceOpen !== undefined ? forceOpen : !isOpen;
      drawer.style.display = next ? 'flex' : 'none';
      if (next && logsWindow) logsWindow.scrollTop = logsWindow.scrollHeight;
    }

    consoleBtn.addEventListener('click', () => toggleDrawer());
    drawer.querySelector('#agy-btn-close-console')?.addEventListener('click', () => toggleDrawer(false));
    badge.addEventListener('click', () => toggleDrawer(true));

    // Open Chrome DevTools button
    drawer.querySelector('#agy-btn-devtools')?.addEventListener('click', async () => {
      try {
        logMsg('DEVTOOLS', 'Opening Chrome DevTools...', 'info');
        await ipcRenderer.invoke('window:toggle-devtools');
      } catch (err: any) {
        logMsg('DEVTOOLS', 'Failed to toggle DevTools: ' + err.message, 'error');
      }
    });

    // Clear logs button
    drawer.querySelector('#agy-btn-clear-logs')?.addEventListener('click', () => {
      rawLogs.length = 0;
      if (logsWindow) logsWindow.innerHTML = '';
      logMsg('CONSOLE', 'Logs cleared.', 'info');
    });

    // Copy logs button
    drawer.querySelector('#agy-btn-copy-logs')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(rawLogs.join('\n'));
        logMsg('CLIPBOARD', 'Copied all logs to clipboard!', 'success');
      } catch (err: any) {
        logMsg('CLIPBOARD', 'Copy failed: ' + err.message, 'error');
      }
    });

    function buildGatewayUrl(): string {
      const url = (serviceUrlInput?.value || '').trim() || localStorage.getItem('agy_voice_service_url') || 'ws://127.0.0.1:8000/ws';
      return url;
    }

    // Save config button
    drawer.querySelector('#agy-btn-save-config')?.addEventListener('click', () => {
      const url = buildGatewayUrl();
      try {
        localStorage.setItem('agy_voice_service_url', url);
        logMsg('CONFIG', `Saved Gemini Live service URL: ${url}`, 'success');
        if (voiceState !== 'idle') {
          stopVoiceSession();
          void startVoiceSession();
        } else {
          testGatewayConnection();
        }
      } catch (e: any) {
        logMsg('CONFIG', 'Failed to save config: ' + e.message, 'error');
      }
    });

    // ─── Diagnostic Tests ───────────────────────────────────────────────────

    let micTestAudioCtx: AudioContext | null = null;
    let micTestStream: MediaStream | null = null;

    async function runMicTest() {
      try {
        logMsg('MIC-TEST', 'Requesting microphone access via getUserMedia...', 'mic');
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true },
        });
        micTestStream = stream;
        const track = stream.getAudioTracks()[0];
        logMsg('MIC-TEST', `Mic access GRANTED! Device: "${track.label}"`, 'success');

        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        micTestAudioCtx = new AudioContextClass();
        const src = micTestAudioCtx.createMediaStreamSource(stream);
        const proc = micTestAudioCtx.createScriptProcessor(2048, 1, 1);

        let peakRms = 0;
        proc.onaudioprocess = (e) => {
          const ch = e.inputBuffer.getChannelData(0);
          let sum = 0;
          for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
          const rms = Math.sqrt(sum / ch.length);
          if (rms > peakRms) peakRms = rms;
          const pct = Math.min(100, Math.round(rms * 400));
          if (meterInner) meterInner.style.width = pct + '%';
          if (meterVal) meterVal.textContent = pct + '%';
        };

        src.connect(proc);
        proc.connect(micTestAudioCtx.destination);
        logMsg('MIC-TEST', 'Listening for 5 seconds... Speak into your microphone now!', 'mic');

        setTimeout(() => {
          try {
            proc.disconnect();
            src.disconnect();
            void micTestAudioCtx?.close();
            stream.getTracks().forEach((t) => t.stop());
            if (meterInner) meterInner.style.width = '0%';
            if (meterVal) meterVal.textContent = '0%';
            logMsg(
              'MIC-TEST',
              `Test finished. Peak Volume: ${Math.round(peakRms * 100)}% (RMS: ${peakRms.toFixed(4)})`,
              peakRms > 0.01 ? 'success' : 'warn',
            );
          } catch (_) {}
        }, 5000);
      } catch (err: any) {
        logMsg('MIC-TEST', `Microphone access FAILED: ${err.name} - ${err.message}`, 'error');
        toggleDrawer(true);
      }
    }

    drawer.querySelector('#agy-btn-test-mic')?.addEventListener('click', runMicTest);

    function testGatewayConnection() {
      const url = buildGatewayUrl();
      logMsg('GW-TEST', `Testing connection to ${url}...`, 'ws');
      const testWs = new WebSocket(url);

      const start = Date.now();
      testWs.onopen = () => {
        logMsg('GW-TEST', `Connected to Gemini Live service in ${Date.now() - start}ms! Sending ping...`, 'success');
        testWs.send(JSON.stringify({ text: 'Ping test from Antigravity Live Voice' }));
      };
      testWs.onmessage = (e) => {
        try {
          if (typeof e.data === 'string') {
            const parsed = JSON.parse(e.data);
            logMsg('GW-TEST', `Received event: ${parsed.type || 'message'}`, 'info');
          } else {
            logMsg('GW-TEST', `Received audio frame (${(e.data as ArrayBuffer).byteLength} bytes)`, 'success');
          }
        } catch (_) {}
      };
      testWs.onerror = (e: any) => {
        logMsg('GW-TEST', 'WebSocket transport error: ' + (e?.message || 'Check if service is running on port 8000'), 'error');
      };
      testWs.onclose = (e) => {
        logMsg('GW-TEST', `Test connection finished (code: ${e.code}).`, 'info');
      };
    }

    drawer.querySelector('#agy-btn-test-gw')?.addEventListener('click', () => testGatewayConnection());

    // ─── Intelligent Hands-Free Vocal Engine (Bandpass + Adaptive Noise Floor) ──

    let voiceState: 'idle' | 'connecting' | 'listening' | 'speaking' | 'error' = 'idle';
    let ws: WebSocket | null = null;
    let micStream: MediaStream | null = null;
    let micAudioCtx: AudioContext | null = null;
    let micProcessor: ScriptProcessorNode | null = null;

    let playbackAudioCtx: AudioContext | null = null;
    let scheduledSources: AudioBufferSourceNode[] = [];
    let nextStartTime = 0;
    let lastPlaybackEndTime = 0;

    // VAD & Adaptive Noise Floor State
    let adaptiveNoiseFloor = 0.015;
    let isUserSpeaking = false;
    let lastVocalSpeechTime = 0;
    let speechFramesCount = 0;
    const preRollBuffer: ArrayBuffer[] = []; // Stores recent 250ms of audio frames before speech confirmation
    const NATURAL_PAUSE_MS = 1100; // 1.1s natural pause to formulate thoughts
    let activeConvInterval: any = null;
    let pauseThinkingTimeout: any = null;

    function getPlaybackContext(): AudioContext {
      if (!playbackAudioCtx || playbackAudioCtx.state === 'closed') {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        playbackAudioCtx = new AudioContextClass();
      }
      if (playbackAudioCtx.state === 'suspended') {
        void playbackAudioCtx.resume();
      }
      return playbackAudioCtx;
    }

    let audioChunkQueue: Float32Array[] = [];
    let isFlushingAudioQueue = false;
    let playbackChunkTimeout: any = null;

    function playAudioChunk(arrayBuffer: ArrayBuffer) {
      try {
        if (pauseThinkingTimeout) {
          clearTimeout(pauseThinkingTimeout);
          pauseThinkingTimeout = null;
        }
        const pcmData = new Int16Array(arrayBuffer);
        if (pcmData.length === 0) return;

        const float32Data = new Float32Array(pcmData.length);
        for (let i = 0; i < pcmData.length; i++) {
          float32Data[i] = pcmData[i] / 32768.0;
        }

        audioChunkQueue.push(float32Data);
        scheduleAudioPlayback();
      } catch (err: any) {
        logMsg('AUDIO', 'Playback error: ' + err.message, 'error');
      }
    }

    function scheduleAudioPlayback() {
      const ctx = getPlaybackContext();
      const now = ctx.currentTime;

      // If scheduledSources is empty, this is a fresh utterance.
      // Wait for a 150ms buffer (or 3 chunks) before starting to eliminate network arrival jitter.
      if (scheduledSources.length === 0 && nextStartTime <= now) {
        let totalSamples = 0;
        for (const c of audioChunkQueue) totalSamples += c.length;
        const bufferedMs = (totalSamples / 24000) * 1000;

        if (bufferedMs < 120 && audioChunkQueue.length < 3) {
          if (!playbackChunkTimeout) {
            playbackChunkTimeout = setTimeout(() => {
              playbackChunkTimeout = null;
              scheduleAudioPlayback();
            }, 40);
          }
          return;
        }
      }

      if (playbackChunkTimeout) {
        clearTimeout(playbackChunkTimeout);
        playbackChunkTimeout = null;
      }

      // Schedule all queued chunks seamlessly back-to-back
      while (audioChunkQueue.length > 0) {
        const float32Data = audioChunkQueue.shift()!;
        const buffer = ctx.createBuffer(1, float32Data.length, 24000);
        buffer.getChannelData(0).set(float32Data);

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);

        const currentTime = ctx.currentTime;
        if (nextStartTime < currentTime) {
          // If playback fell behind, start slightly in the future (100ms safety window)
          nextStartTime = currentTime + 0.10;
        }

        source.start(nextStartTime);
        nextStartTime += buffer.duration;
        scheduledSources.push(source);

        source.onended = () => {
          const idx = scheduledSources.indexOf(source);
          if (idx > -1) scheduledSources.splice(idx, 1);
          if (scheduledSources.length === 0 && audioChunkQueue.length === 0) {
            lastPlaybackEndTime = Date.now();
            if (voiceState === 'speaking' && !isUserSpeaking) {
              updateUiState('listening', '🎙️ Listening... (Speak naturally anytime)');
              logMsg('SESSION', 'Gemini finished speaking. Listening for your next question...', 'info');
            }
          }
        };
      }

      if (voiceState !== 'speaking' && !isUserSpeaking) {
        updateUiState('speaking', '🔊 Gemini speaking... (Speak to interrupt or Esc)');
      }
    }

    function stopAudioPlayback() {
      if (playbackChunkTimeout) {
        clearTimeout(playbackChunkTimeout);
        playbackChunkTimeout = null;
      }
      audioChunkQueue = [];
      for (const s of scheduledSources) {
        try {
          s.stop();
        } catch (_) {}
      }
      scheduledSources = [];
      lastPlaybackEndTime = Date.now();
      if (playbackAudioCtx) {
        nextStartTime = playbackAudioCtx.currentTime;
      }
    }

    function downsampleBuffer(buffer: Float32Array, inputRate: number, outputRate: number): Float32Array {
      if (outputRate === inputRate) return buffer;
      const ratio = inputRate / outputRate;
      const newLength = Math.round(buffer.length / ratio);
      const result = new Float32Array(newLength);
      let offsetResult = 0;
      let offsetBuffer = 0;
      while (offsetResult < result.length) {
        const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
        let accum = 0;
        let count = 0;
        for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
          accum += buffer[i];
          count++;
        }
        result[offsetResult] = count > 0 ? accum / count : 0;
        offsetResult++;
        offsetBuffer = nextOffsetBuffer;
      }
      return result;
    }

    function updateUiState(newState: typeof voiceState, message?: string) {
      voiceState = newState;
      micBtn.className = newState !== 'idle' ? newState : '';
      if (statusPill) {
        statusPill.textContent = newState.toUpperCase();
        statusPill.className = `agy-console-status-pill ${newState}`;
      }

      if (message) {
        badge.textContent = message;
        badge.style.display = 'block';
      } else {
        switch (newState) {
          case 'idle':
            badge.textContent = 'Gemini Live (Cmd+Shift+V)';
            badge.style.display = 'none';
            break;
          case 'connecting':
            badge.textContent = 'Connecting to Gemini Live...';
            badge.style.display = 'block';
            break;
          case 'listening':
            badge.textContent = '🎙️ Listening... (Speak naturally)';
            badge.style.display = 'block';
            break;
          case 'speaking':
            badge.textContent = '🔊 Gemini speaking... (Speak to interrupt)';
            badge.style.display = 'block';
            break;
          case 'error':
            badge.textContent = 'Voice Error (Click to inspect)';
            badge.style.display = 'block';
            break;
        }
      }
    }

    async function startVoiceSession() {
      try {
        stopAudioPlayback();
        updateUiState('connecting', 'Connecting to Gemini Live...');
        logMsg('SESSION', 'Starting hands-free live voice session...', 'info');

        // Request microphone access with aggressive echo cancellation and noise suppression
        if (!micStream) {
          logMsg('MIC', 'Opening microphone with hardware noise suppression & echo cancellation...', 'mic');
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              channelCount: 1,
              sampleRate: 16000,
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          logMsg('MIC', 'Microphone stream acquired.', 'success');
        }

        // Connect to Gemini Live service on port 8000
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          const baseWsUrl = buildGatewayUrl();
          const initialConvId = getActiveConversationId();
          const wsUrl = initialConvId
            ? `${baseWsUrl}${baseWsUrl.includes('?') ? '&' : '?'}conversation_id=${encodeURIComponent(initialConvId)}`
            : baseWsUrl;
          logMsg('WS', `Connecting to Gemini Live backend (${wsUrl})...`, 'ws');
          ws = new WebSocket(wsUrl);
          ws.binaryType = 'arraybuffer';

          const handleWsMessage = (event: MessageEvent) => {
            if (event.data instanceof ArrayBuffer) {
              // Downstream neural audio chunk from Gemini Live
              playAudioChunk(event.data);
            } else if (typeof event.data === 'string') {
              try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'interaction_status') {
                  if (msg.status === 'IN_PROGRESS') {
                    logMsg('STATUS', 'Gemini thinking...', 'info');
                  } else if (msg.status === 'REQUIRES_ACTION') {
                    if (voiceState !== 'speaking' && scheduledSources.length === 0) {
                      updateUiState('listening', '🎙️ Listening... (Speak naturally anytime)');
                    }
                  }
                } else if (msg.type === 'interrupted') {
                  logMsg('STATUS', 'Session interrupted.', 'vad');
                  stopAudioPlayback();
                } else if (msg.type === 'turn_complete') {
                  logMsg('STATUS', 'Turn complete.', 'info');
                  if (pauseThinkingTimeout) {
                    clearTimeout(pauseThinkingTimeout);
                    pauseThinkingTimeout = null;
                  }
                  if (voiceState !== 'idle' && scheduledSources.length === 0) {
                    updateUiState('listening', '🎙️ Listening... (Speak naturally anytime)');
                  }
                } else if (msg.type === 'user' && msg.text) {
                  renderTranscriptLine('User', msg.text);
                } else if ((msg.type === 'model' || msg.type === 'gemini') && msg.text) {
                  renderTranscriptLine('Gemini', msg.text);
                } else if (msg.type === 'tool_call') {
                  if (msg.name === 'search_web') {
                    const query = msg.args?.query || '';
                    const results = msg.result?.results || [];
                    let cardHtml = `<strong>🔍 Web Search:</strong> <em>"${escapeHtml(query)}"</em><br/>`;
                    if (results.length > 0) {
                      cardHtml += `<div style="margin-top:4px;padding-left:8px;border-left:2px solid #38bdf8;">`;
                      results.forEach((r: any, idx: number) => {
                        const title = escapeHtml(r.title || 'Source');
                        const url = escapeHtml(r.url || '#');
                        const snippet = escapeHtml((r.snippet || '').slice(0, 140));
                        cardHtml += `<div style="margin-bottom:4px;">${idx + 1}. <a href="${url}" target="_blank" style="color:#38bdf8;text-decoration:underline;">${title}</a><br/><span style="color:#94a3b8;font-size:10px;">${snippet}...</span></div>`;
                      });
                      cardHtml += `</div>`;
                    } else {
                      cardHtml += `<span style="color:#94a3b8;">No results found.</span>`;
                    }
                    logMsg('RESEARCH', cardHtml, 'model', true);
                  } else if (msg.name === 'read_url_content') {
                    const title = escapeHtml(msg.result?.title || msg.args?.url || 'Web Page');
                    const url = escapeHtml(msg.args?.url || '#');
                    const snippet = escapeHtml((msg.result?.content || '').slice(0, 200));
                    const cardHtml = `<strong>📄 Read Page:</strong> <a href="${url}" target="_blank" style="color:#38bdf8;text-decoration:underline;">${title}</a><br/><span style="color:#94a3b8;font-size:10px;">${snippet}...</span>`;
                    logMsg('RESEARCH', cardHtml, 'model', true);
                  } else {
                    logMsg('TOOL', `Called ${msg.name}: ${JSON.stringify(msg.args || {})}`, 'info');
                  }
                } else if (msg.type === 'session_reconnecting') {
                  logMsg('WS', `Backend refreshing Gemini Live session: ${msg.error || ''}`, 'ws');
                  updateUiState('listening', '🔄 Resuming Gemini Live...');
                } else if (msg.type === 'interrupted') {
                  logMsg('INTERRUPT', 'Gemini Live detected user speech interrupt.', 'vad');
                  stopAudioPlayback();
                  updateUiState('listening', '🎙️ Listening to you...');
                } else if (msg.type === 'error') {
                  logMsg('ERROR', `Server reported error: ${msg.error}`, 'error');
                  updateUiState('error', msg.error);
                  toggleDrawer(true);
                }
              } catch (e: any) {
                logMsg('WS', 'Error parsing message: ' + e.message, 'error');
              }
            }
          };

          ws.onmessage = handleWsMessage;

          ws.onopen = () => {
            logMsg('WS', 'Connected to Gemini Live backend!', 'success');
            updateUiState('listening', '🎙️ Listening... (Speak naturally anytime)');
            startMicAudioPipeline();

            // Pin Butler exclusively to the active chat session and monitor for tab switches
            let currentTrackedConvId = initialConvId || getActiveConversationId();
            if (currentTrackedConvId) {
              ws.send(JSON.stringify({ type: 'set_active_conversation', conversation_id: currentTrackedConvId }));
              logMsg('BUTLER', `Pinned Butler to active chat: ${currentTrackedConvId}`, 'info');
            }

            if (activeConvInterval) clearInterval(activeConvInterval);
            activeConvInterval = setInterval(() => {
              const latestId = getActiveConversationId();
              if (latestId && latestId !== currentTrackedConvId) {
                currentTrackedConvId = latestId;
                logMsg('BUTLER', `Active chat tab switched to: ${latestId}. Cleanly resetting Gemini Live session...`, 'info');
                stopAudioPlayback();
                if (ws) {
                  try {
                    ws.onclose = null;
                    ws.onerror = null;
                    ws.close();
                  } catch (_) {}
                  ws = null;
                }
                const newBaseUrl = buildGatewayUrl();
                const newWsUrl = `${newBaseUrl}${newBaseUrl.includes('?') ? '&' : '?'}conversation_id=${encodeURIComponent(latestId)}`;
                logMsg('WS', `Reconnecting to Gemini Live for tab ${latestId}...`, 'ws');
                ws = new WebSocket(newWsUrl);
                ws.binaryType = 'arraybuffer';
                ws.onopen = () => {
                  logMsg('WS', `Connected to clean Gemini Live session for tab: ${latestId}`, 'success');
                  ws.send(JSON.stringify({ type: 'set_active_conversation', conversation_id: latestId }));
                };
                ws.onmessage = handleWsMessage;
                ws.onclose = () => {
                  logMsg('WS', 'Session disconnected.', 'ws');
                };
                ws.onerror = (e) => {
                  logMsg('ERROR', 'WebSocket error during reconnect.', 'error');
                };
              }
            }, 300);
          };

          ws.onerror = (err: any) => {
            logMsg('WS', 'WebSocket error: ' + (err?.message || 'Check if service is running on port 8000'), 'error');
          };

          ws.onclose = (e) => {
            logMsg('WS', `Connection closed (code: ${e.code}, reason: "${e.reason || 'none'}"). Auto-reconnecting...`, 'info');
            // Auto-reconnect failsafe if session was actively in progress
            if (voiceState !== 'idle' && voiceState !== 'error') {
              updateUiState('connecting', '🔄 Reconnecting to Gemini Live...');
              setTimeout(() => {
                if (voiceState !== 'idle') {
                  void startVoiceSession();
                }
              }, 1500);
            }
          };
        } else {
          updateUiState('listening', '🎙️ Listening... (Speak naturally anytime)');
          startMicAudioPipeline();
        }
      } catch (err: any) {
        logMsg('MIC', `Mic access failed: ${err.name} - ${err.message}`, 'error');
        updateUiState('error', err.message || 'Mic access denied');
        toggleDrawer(true);
      }
    }

    function startMicAudioPipeline() {
      if (!micStream) return;
      if (micProcessor) return; // Already running

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      micAudioCtx = new AudioContextClass();
      const sourceNode = micAudioCtx.createMediaStreamSource(micStream);

      // 1. Highpass filter: cuts music sub-bass, kick drum, table thuds < 200 Hz
      const highpass = micAudioCtx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 200;
      highpass.Q.value = 0.707;

      // 2. Lowpass filter: cuts cymbals, piercing highs, background music synths > 3400 Hz
      const lowpass = micAudioCtx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 3400;
      lowpass.Q.value = 0.707;

      sourceNode.connect(highpass);
      highpass.connect(lowpass);

      micProcessor = micAudioCtx.createScriptProcessor(2048, 1, 1);
      lowpass.connect(micProcessor);
      micProcessor.connect(micAudioCtx.destination);

      micProcessor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);

        // RMS of vocal bandpass filtered audio
        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
        const rms = Math.sqrt(sum / input.length);

        const isButlerAudioPlaying = scheduledSources.length > 0;

        // Dynamically adapt noise floor during ambient sounds when Butler is NOT speaking
        if (!isUserSpeaking && !isButlerAudioPlaying) {
          adaptiveNoiseFloor = adaptiveNoiseFloor * 0.96 + rms * 0.04;
        }

        // Responsive speech threshold with lower floor so gentle words trigger immediately
        const speechThreshold = Math.max(0.018, adaptiveNoiseFloor * 1.8);

        // Live visual meter
        if (drawer.style.display === 'flex' && meterInner) {
          const pct = Math.min(100, Math.round(rms * 400));
          meterInner.style.width = pct + '%';
          if (meterVal) meterVal.textContent = pct + '% (Floor: ' + Math.round(adaptiveNoiseFloor * 400) + '%)';
        }

        const now = Date.now();

        // ─── BARGE-IN / INTERRUPTION HANDLING ───
        // If Gemini is currently speaking and user starts talking louder than background bleed:
        if (isButlerAudioPlaying) {
          const bargeInThreshold = Math.max(0.040, speechThreshold * 1.4);
          if (rms > bargeInThreshold) {
            logMsg('INTERRUPT', `Barge-in vocal interrupt detected (RMS: ${rms.toFixed(3)})! Stopping playback.`, 'vad');
            stopAudioPlayback();
            isUserSpeaking = true;
            lastVocalSpeechTime = now;
            updateUiState('listening', '🎙️ Listening to you...');
            // Notify server of interrupt immediately
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'interrupt' }));
            }
          } else {
            // Speaker bleed protection: don't stream speaker audio back to Gemini
            return;
          }
        }

        // Prepare downsampled PCM16 frame (16kHz standard for Gemini Live)
        const downsampled = downsampleBuffer(input, micAudioCtx.sampleRate, 16000);
        const pcm16 = new Int16Array(downsampled.length);
        for (let i = 0; i < downsampled.length; i++) {
          const s = Math.max(-1, Math.min(1, downsampled[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        // Immediate speech detection: single frame is sufficient to mark speech active
        if (rms > speechThreshold) {
          lastVocalSpeechTime = now;

          if (!isUserSpeaking) {
            isUserSpeaking = true;
            logMsg('VAD', `Speech detected (RMS: ${rms.toFixed(3)}, Floor: ${adaptiveNoiseFloor.toFixed(3)})`, 'vad');
            updateUiState('listening', '🎙️ Listening to you...');
          }
        }

        // CONTINUOUS STREAMING: Always stream mic frames over WebSocket when session is open
        // Gemini Live's native server-side neural VAD handles real-time semantic endpointing!
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(pcm16.buffer);
        }

        // Natural pause detection to update UI and send end-of-utterance prompt if user pauses
        if (isUserSpeaking && (now - lastVocalSpeechTime > NATURAL_PAUSE_MS)) {
          isUserSpeaking = false;
          logMsg('TURN', `Natural pause (${NATURAL_PAUSE_MS}ms) detected. Gemini answering...`, 'info');
          updateUiState('speaking', '⏳ Gemini thinking...');
          if (ws && ws.readyState === WebSocket.OPEN) {
            const silence = new Int16Array(1600); // 100ms silence delimiter
            ws.send(silence.buffer);
          }

          // Watchdog: If Gemini does not send audio or turn_complete within 8s, cleanly reset to listening
          if (pauseThinkingTimeout) clearTimeout(pauseThinkingTimeout);
          pauseThinkingTimeout = setTimeout(() => {
            if (scheduledSources.length === 0 && voiceState !== 'idle') {
              logMsg('TIMEOUT', 'Response timeout recovered. Resetting to active listening.', 'warn');
              updateUiState('listening', '🎙️ Listening... (Speak naturally)');
            }
            pauseThinkingTimeout = null;
          }, 8000);
        }
      };

      logMsg('MIC', 'Vocal bandpass (200-3400Hz) & adaptive noise tracker active.', 'success');
      logMsg('TIP', 'Pro-tip: For total silence of loud music, enable "Voice Isolation" from your Mac menu bar mic icon.', 'info');
    }

    function stopVoiceSession() {
      isUserSpeaking = false;
      if (pauseThinkingTimeout) {
        clearTimeout(pauseThinkingTimeout);
        pauseThinkingTimeout = null;
      }
      stopAudioPlayback();

      if (micProcessor) {
        try {
          micProcessor.disconnect();
        } catch (_) {}
        micProcessor = null;
      }

      if (micAudioCtx) {
        try {
          void micAudioCtx.close();
        } catch (_) {}
        micAudioCtx = null;
      }

      if (micStream) {
        try {
          micStream.getTracks().forEach((track) => track.stop());
        } catch (_) {}
        micStream = null;
      }

      if (activeConvInterval) {
        clearInterval(activeConvInterval);
        activeConvInterval = null;
      }

      if (ws) {
        try {
          ws.close();
        } catch (_) {}
        ws = null;
      }

      if (meterInner) meterInner.style.width = '0%';
      if (meterVal) meterVal.textContent = '0%';
      updateUiState('idle');
      logMsg('SESSION', 'Live voice session stopped.', 'info');

      // Resume hands-free wake word listener when returning to idle
      if (wakeWordEnabled) {
        setTimeout(() => {
          startWakeWordListener();
        }, 500);
      }
    }

    function handleVoiceTrigger() {
      if (voiceState === 'idle') {
        void startVoiceSession();
      } else if (voiceState === 'speaking') {
        // Tap mic to silence immediately
        logMsg('INTERRUPT', 'Silenced playback manually.', 'vad');
        stopAudioPlayback();
        updateUiState('listening', '🎙️ Listening... (Speak naturally)');
      } else {
        stopVoiceSession();
      }
    }

    micBtn.addEventListener('click', handleVoiceTrigger);

    // ─── Hands-Free Wake Word Engine (Disabled / On-hold) ───
    let wakeWordEnabled = false;
    try {
      const savedWakeSetting = localStorage.getItem('agy_wakeword_enabled');
      if (savedWakeSetting !== null) {
        wakeWordEnabled = savedWakeSetting === 'true';
      }
    } catch (_) {}

    if (wakeWordToggle) {
      wakeWordToggle.checked = wakeWordEnabled;
      if (wakeWordStatus) {
        wakeWordStatus.textContent = wakeWordEnabled ? 'Active' : 'Disabled';
        wakeWordStatus.style.color = wakeWordEnabled ? '#34d399' : '#9ca3af';
      }
      wakeWordToggle.addEventListener('change', () => {
        wakeWordEnabled = wakeWordToggle.checked;
        try {
          localStorage.setItem('agy_wakeword_enabled', String(wakeWordEnabled));
        } catch (_) {}
        if (wakeWordStatus) {
          wakeWordStatus.textContent = wakeWordEnabled ? 'Active' : 'Disabled';
          wakeWordStatus.style.color = wakeWordEnabled ? '#34d399' : '#9ca3af';
        }
        if (wakeWordEnabled) {
          startWakeWordListener();
        } else {
          stopWakeWordListener();
        }
        logMsg('WAKE', `Hands-free wake word ${wakeWordEnabled ? 'enabled' : 'disabled'}.`, 'info');
      });
    }

    let wakeRecognition: any = null;
    let wakeWordRestartTimer: any = null;
    let isWakeWordRunning = false;

    function isWakePhrase(text: string): { matched: boolean; query: string } {
      const clean = text.toLowerCase().trim();
      // Patterns matching: "hey gemini", "hey antigravity", "ok gemini", "gemini", "antigravity"
      const wakeRegex = /^(?:hey\s+|ok\s+|hello\s+)?(?:gemini|antigravity)(?:\s*[,:\-]?\s*(.*))?$/i;
      const match = clean.match(wakeRegex);
      if (match) {
        return { matched: true, query: (match[1] || '').trim() };
      }
      // Also check if wake phrase appears anywhere near the start of the utterance
      const subMatch = clean.match(/\b(?:hey|ok|hello)?\s*(?:gemini|antigravity)\b\s*[,:\-]?\s*(.*)/i);
      if (subMatch) {
        return { matched: true, query: (subMatch[1] || '').trim() };
      }
      return { matched: false, query: '' };
    }

    function startWakeWordListener() {
      if (!wakeWordEnabled || isWakeWordRunning) return;
      if (voiceState !== 'idle') return; // Do not run wake recognizer while active Live session is running

      const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRec) {
        logMsg('WAKE', 'SpeechRecognition API not available in this environment.', 'warn');
        return;
      }

      try {
        if (wakeRecognition) {
          try {
            wakeRecognition.abort();
          } catch (_) {}
          wakeRecognition = null;
        }

        const rec = new SpeechRec();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = 'en-US';

        rec.onstart = () => {
          isWakeWordRunning = true;
          logMsg('WAKE', 'Hands-free wake listener active (listening for "Hey Gemini" / "Hey Antigravity")...', 'vad');
        };

        rec.onresult = (event: any) => {
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            const isFinal = event.results[i].isFinal;
            const { matched, query } = isWakePhrase(transcript);

            if (matched) {
              logMsg('WAKE', `Wake word triggered: "${transcript}" (Query: "${query || '[none]'}")`, 'success');
              stopWakeWordListener();

              // Immediately wake up Gemini Live
              void startVoiceSession();

              // If a follow-up query was spoken in the same breath, send it as initial text to Gemini Live
              if (query && query.length > 1) {
                setTimeout(() => {
                  if (ws && ws.readyState === WebSocket.OPEN) {
                    logMsg('WAKE', `Sending initial voice prompt query: "${query}"`, 'info');
                    ws.send(JSON.stringify({ text: query }));
                  }
                }, 350);
              }
              break;
            }
          }
        };

        rec.onerror = (e: any) => {
          if (e.error !== 'no-speech' && e.error !== 'aborted') {
            logMsg('WAKE', `Wake listener notice: ${e.error}`, 'warn');
          }
        };

        rec.onend = () => {
          isWakeWordRunning = false;
          // Automatically keep alive if session is still idle and wake word is enabled
          if (wakeWordEnabled && voiceState === 'idle') {
            if (wakeWordRestartTimer) clearTimeout(wakeWordRestartTimer);
            wakeWordRestartTimer = setTimeout(() => {
              startWakeWordListener();
            }, 300);
          }
        };

        wakeRecognition = rec;
        rec.start();
      } catch (err: any) {
        isWakeWordRunning = false;
        logMsg('WAKE', `Could not initialize wake listener: ${err.message}`, 'error');
      }
    }

    function stopWakeWordListener() {
      isWakeWordRunning = false;
      if (wakeWordRestartTimer) {
        clearTimeout(wakeWordRestartTimer);
        wakeWordRestartTimer = null;
      }
      if (wakeRecognition) {
        try {
          wakeRecognition.abort();
        } catch (_) {}
        wakeRecognition = null;
      }
    }

    // Initialize wake word listener on startup
    if (wakeWordEnabled) {
      setTimeout(() => {
        startWakeWordListener();
      }, 1000);
    }

    // Global Keybindings:
    // - Cmd+Shift+V / Ctrl+Shift+V: Hands-Free Voice Toggle
    // - Cmd+Shift+D / Ctrl+Shift+D: Drawer Toggle
    // - Escape (during playback): Silence Gemini immediately
    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyV') {
          e.preventDefault();
          e.stopPropagation();
          handleVoiceTrigger();
        } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyD') {
          e.preventDefault();
          e.stopPropagation();
          toggleDrawer();
        } else if (e.code === 'Escape' && (voiceState === 'speaking' || scheduledSources.length > 0)) {
          e.preventDefault();
          e.stopPropagation();
          logMsg('INTERRUPT', 'Silenced playback via Escape key.', 'vad');
          stopAudioPlayback();
          updateUiState('listening', '🎙️ Listening... (Speak naturally)');
        }
      },
      true,
    );
  }

  // Efficient DOM tracking via MutationObserver — instead of setInterval
  let injectionObserver: MutationObserver | null = null;
  let injectionDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  function setupInjectionObserver(): void {
    // Try immediately first
    void injectCustomModelsSection();
    try {
      setupVoiceInterface();
    } catch (_) {}

    // If already added, no need for observer
    if (document.getElementById('agy-custom-models-section')) return;

    // Set up observer: watch all changes under document.body
    injectionObserver = new MutationObserver(() => {
      // Debounce: coalesce consecutive mutations into a single attempt
      if (injectionDebounceTimer) clearTimeout(injectionDebounceTimer);
      injectionDebounceTimer = setTimeout(async () => {
        await injectCustomModelsSection();
        // If successfully injected, stop observing
        if (document.getElementById('agy-custom-models-section')) {
          if (injectionObserver) {
            injectionObserver.disconnect();
            injectionObserver = null;
          }
        }
      }, 200);
    });

    injectionObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // URL tracking for re-injection on SPA page transitions
  let lastUrl = location.href;
  setInterval(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      // Page changed — clean up previous observer and re-initialize
      if (injectionObserver) {
        injectionObserver.disconnect();
        injectionObserver = null;
      }
      // Re-initialize after a short delay (for new DOM to render)
      setTimeout(setupInjectionObserver, 500);
    }
  }, 1500);

  // --- Network Interceptor for Model Injection --------------------------

  function isSafeToIntercept(url: string): boolean {
    // Never touch the internal Connect-RPC LanguageServerService channel —
    // those responses are protocol-framed, not plain JSON, and rewriting
    // them corrupts the renderer's RPC client / store hydration.
    if (url.includes('exa.language_server_pb.')) return false;
    if (url.includes('/LanguageServerService/')) return false;
    return true;
  }

  function isJsonResponse(contentType: string | null): boolean {
    return contentType?.split(';', 1)[0].trim().toLowerCase() === 'application/json';
  }

  const customModelsCache: { models: any[]; ts: number } = { models: [], ts: 0 };

  async function getCustomModelsForInjection(): Promise<any[]> {
    if (Date.now() - customModelsCache.ts < 30000) return customModelsCache.models;
    try {
      customModelsCache.models = await storageAPI.getCustomModels();
      customModelsCache.ts = Date.now();
    } catch { /* ignore */ }
    return customModelsCache.models;
  }

  // Intercept XHR to inject custom models into GetAvailableModels responses
  const origXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ) {
    (this as any)._agy_url = typeof url === 'string' ? url : url.toString();
    (this as any)._agy_method = method;
    (this as any)._agy_async = async !== false;
    return origXHROpen.call(this, method, url, async !== false, username, password);
  };

  const origXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
    const url: string = (this as any)._agy_url || '';

    if ((url.includes('GetAvailableModels') || url.includes('fetchAvailableModels')) && isSafeToIntercept(url)) {
      // Warm the cache without delaying native XHR events. If it is not ready by
      // DONE, leave the response alone; load/readystatechange ordering must survive.
      if ((this as any)._agy_async) void getCustomModelsForInjection();
      const origOnReady = this.onreadystatechange;
      this.onreadystatechange = (ev: Event) => {
        if (
          this.readyState === 4 &&
          this.status === 200 &&
          (this.responseType === '' || this.responseType === 'text') &&
          isJsonResponse(this.getResponseHeader('content-type'))
        ) {
          const customModels = customModelsCache.models;
          if (customModels && customModels.length > 0) {
            try {
              const responseText = this.responseText;
              if (responseText && responseText.length > 10) {
                const parsed = JSON.parse(responseText) as Record<string, unknown>;
                const modelsObj = (parsed.models || parsed.availableModels || parsed.available_models || {}) as Record<string, unknown>;
                for (const m of customModels) {
                  const slug = 'custom-' + ((m.externalModelName || m.name || '') as string)
                    .replace(/^models\//, '')
                    .replace(/[^a-zA-Z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '')
                    .toLowerCase();
                  (modelsObj as Record<string, unknown>)[slug] = {
                    displayName: m.displayName || m.name,
                    recommended: true,
                    maxTokens: 1048576,
                    maxOutputTokens: 4096,
                    tokenizerType: 'LLAMA_WITH_SPECIAL',
                    model: 'MODEL_PLACEHOLDER_M' + (400 + (Math.abs(hashCodeStr(m.displayName || m.name || '') as number) % 200)),
                    apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                    modelProvider: 'MODEL_PROVIDER_GOOGLE',
                  };
                }
                // Override response
                Object.defineProperty(this, 'responseText', { value: JSON.stringify(parsed), writable: true });
                Object.defineProperty(this, 'response', { value: JSON.stringify(parsed), writable: true });
              }
            } catch { /* ignore parse errors */ }
          }
        }
        if (origOnReady) origOnReady.call(this, ev);
      };
    }
    return origXHRSend.call(this, body);
  };

  // Intercept fetch responses for model endpoints
  const origFetch = window.fetch;
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const response = await origFetch.call(window, input, init);

    if ((url.includes('GetAvailableModels') || url.includes('fetchAvailableModels')) && isSafeToIntercept(url) && response.ok) {
      if (!isJsonResponse(response.headers.get('content-type'))) {
        return response;
      }
      const customModels = await getCustomModelsForInjection();
      if (customModels && customModels.length > 0) {
        try {
          const cloned = response.clone();
          const text = await cloned.text();
          if (text && text.length > 10) {
            const parsed = JSON.parse(text) as Record<string, unknown>;
            const modelsObj = (parsed.models || parsed.availableModels || parsed.available_models || {}) as Record<string, unknown>;
            for (const m of customModels) {
              const slug = 'custom-' + ((m.externalModelName || m.name || '') as string)
                .replace(/^models\//, '')
                .replace(/[^a-zA-Z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .toLowerCase();
              (modelsObj as Record<string, unknown>)[slug] = {
                displayName: m.displayName || m.name,
                recommended: true,
                maxTokens: 1048576,
                maxOutputTokens: 4096,
                tokenizerType: 'LLAMA_WITH_SPECIAL',
                model: 'MODEL_PLACEHOLDER_M' + (400 + (Math.abs(hashCodeStr(m.displayName || m.name || '') as number) % 200)),
                apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                modelProvider: 'MODEL_PROVIDER_GOOGLE',
              };
            }
            return new Response(JSON.stringify(parsed), {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
          }
        } catch { /* ignore parse errors */ }
      }
    }
    return response;
  };

  function hashCodeStr(s: string): number {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = (h << 5) + h + s.charCodeAt(i);
      h = h & h;
    }
    return Math.abs(h);
  }

  // Start the observer
  setupInjectionObserver();
});
