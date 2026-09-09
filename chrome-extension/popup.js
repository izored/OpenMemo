// OpenMemo Popup Script

const statusEl = document.getElementById('status');
const titleEl = document.getElementById('pageTitle');
const urlEl = document.getElementById('pageUrl');
const saveBtn = document.getElementById('saveBtn');
const messageEl = document.getElementById('message');

let pageData = null;

// Check connection
chrome.runtime.sendMessage({ action: 'check-connection' }, (response) => {
  if (response?.connected) {
    statusEl.classList.add('connected');
  } else {
    statusEl.classList.add('disconnected');
    messageEl.textContent = 'Cannot connect to OpenMemo server';
  }
});

// Get current tab info
chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
  const tab = tabs[0];
  titleEl.textContent = tab.title || 'Untitled';
  urlEl.textContent = tab.url;

  // Extract from the live DOM via the content script (Defuddle-style).
  let r;
  try {
    r = await chrome.tabs.sendMessage(tab.id, { action: 'extract-content' });
  } catch {
    // Content script not present (e.g. just-loaded tab) — inject then retry.
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      r = await chrome.tabs.sendMessage(tab.id, { action: 'extract-content' });
    } catch { r = null; }
  }

  // Same rule as the context menu: the content script's URL is the permalink of
  // the post on screen, which on Instagram is a dialog over a profile page that
  // `tab.url` never names.
  pageData = r
    ? {
        type: r.type || 'article',
        url: r.url || tab.url,
        title: r.title || tab.title,
        description: r.description || '',
        content_text: r.content_text || '',
        thumbnail: r.thumbnail || '',
        favicon: tab.favIconUrl || r.favicon || '',
      }
    : { type: 'link', url: tab.url, title: tab.title, content_text: '', favicon: tab.favIconUrl };
  // Show what will actually be saved, not what the address bar says.
  urlEl.textContent = pageData.url;
});

// Save button click
saveBtn.addEventListener('click', async () => {
  if (!pageData) return;
  
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  chrome.runtime.sendMessage({ action: 'save-page', data: pageData }, (response) => {
    if (response?.success) {
      saveBtn.textContent = 'Saved!';
      saveBtn.classList.add('success');
      messageEl.textContent = 'Saved to your knowledge base';
      setTimeout(() => window.close(), 1500);
    } else {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save to OpenMemo';
      messageEl.textContent = 'Failed to save. Is the server running?';
    }
  });
});
