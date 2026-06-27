// OpenMemo Chrome Extension - Background Service Worker

// Docker default. The macOS app and the dev server use :8099 — point there from
// the options page (chrome.storage), which overrides this.
const DEFAULT_API_BASE = 'http://localhost:8091/api';

async function getApiBase() {
  const stored = await chrome.storage.sync.get('apiBase');
  return stored.apiBase || DEFAULT_API_BASE;
}

// Context menu setup
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'save-to-openmemo',
    title: 'Save to OpenMemo',
    contexts: ['page', 'selection', 'link', 'image'],
  });
});

// Context menu click handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'save-to-openmemo') {
    try {
      const API_BASE = await getApiBase();
      const url = info.pageUrl || tab.url;

      // Extract from the live DOM via the content script (Defuddle-style).
      let content;
      try {
        content = await chrome.tabs.sendMessage(tab.id, { action: 'extract-content' });
      } catch {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        content = await chrome.tabs.sendMessage(tab.id, { action: 'extract-content' });
      }
      content = content || {};

      // Save via API
      const response = await fetch(`${API_BASE}/ingest/extension`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: content.type || 'article',
          url: url,
          title: content.title || tab.title,
          description: content.description || '',
          content_text: info.selectionText || content.content_text || '',
          thumbnail: content.thumbnail || '',
          favicon: tab.favIconUrl || content.favicon,
        }),
      });

      if (response.ok) {
        // Show notification
        chrome.action.setBadgeText({ text: '✓', tabId: tab.id });
        chrome.action.setBadgeBackgroundColor({ color: '#D97706' });
        setTimeout(() => {
          chrome.action.setBadgeText({ text: '', tabId: tab.id });
        }, 2000);
      }
    } catch (err) {
      console.error('OpenMemo save failed:', err);
    }
  }
});

// Message handler from popup/content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'save-page') {
    savePage(message.data).then(sendResponse);
    return true;
  }
  if (message.action === 'check-connection') {
    checkConnection().then(sendResponse);
    return true;
  }
});

async function savePage(data) {
  try {
    const API_BASE = await getApiBase();
    const response = await fetch(`${API_BASE}/ingest/extension`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return { success: response.ok };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function checkConnection() {
  try {
    const API_BASE = await getApiBase();
    const response = await fetch(`${API_BASE}/health`);
    const data = await response.json();
    return { connected: true, ollama: data.ollama_connected };
  } catch {
    return { connected: false, ollama: false };
  }
}
