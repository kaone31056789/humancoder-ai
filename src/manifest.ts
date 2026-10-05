/**
 * Source of truth for dist/manifest.json (emitted by the Vite manifest plugin).
 *
 * Permissions are deliberately narrow:
 *  - activeTab + scripting: scripts are injected only into the tab where the user
 *    opened the popup / pressed a shortcut, never into every page.
 *  - host permission only for the OpenRouter API.
 */
export function buildManifest(): chrome.runtime.ManifestV3 {
  return {
    manifest_version: 3,
    name: 'HumanCoder AI',
    version: '0.1.0',
    description:
      'AI coding agent for web code editors: plans validated edit actions via OpenRouter and types them naturally.',
    minimum_chrome_version: '116',
    action: {
      default_title: 'HumanCoder AI',
      default_popup: 'popup/index.html',
      default_icon: {
        16: 'icons/icon16.png',
        32: 'icons/icon32.png',
        48: 'icons/icon48.png',
        128: 'icons/icon128.png',
      },
    },
    icons: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
    options_page: 'options/index.html',
    background: { service_worker: 'background.js', type: 'module' },
    permissions: ['storage', 'activeTab', 'scripting'],
    host_permissions: ['https://openrouter.ai/*'],
    commands: {
      'toggle-pause': {
        suggested_key: { default: 'Alt+Shift+P' },
        description: 'Pause / resume the running session',
      },
      'stop-session': {
        suggested_key: { default: 'Alt+Shift+X' },
        description: 'Stop the running session',
      },
    },
  };
}
