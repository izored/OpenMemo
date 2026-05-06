// OpenMemo Chrome Extension - Background Service Worker

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
      // Get page content via content script
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPageContent,
      });

      const content = result.result;
      
      // Detect type
      let type = 'article';
      const url = info.pageUrl || tab.url;
      if (url.includes('youtube.com') || url.includes('youtu.be')) type = 'video';
      else if (url.includes('twitter.com') || url.includes('x.com')) type = 'twitter';
      else if (url.includes('reddit.com')) type = 'reddit';
      
      // Save via API
      const response = await fetch(`${API_BASE}/ingest/extension`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          url: url,
          title: content.title || tab.title,
          content_text: info.selectionText || content.text,
          html: content.html,
          favicon: tab.favIconUrl,
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

// Content extraction function injected into pages
function extractPageContent() {
  const title = document.title;
  
  // Try to get article content
  const article = document.querySelector('article') || document.querySelector('main') || document.body;
  const text = article.innerText.slice(0, 10000);
  const html = article.innerHTML.slice(0, 50000);
  
  // Get meta description
  const metaDesc = document.querySelector('meta[name="description"]');
  const description = metaDesc ? metaDesc.content : '';
  
  return { title, text, html, description };
}
