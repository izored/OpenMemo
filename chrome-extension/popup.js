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

  // Extract content from page
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const article = document.querySelector('article') || document.querySelector('main') || document.body;
        return {
          title: document.title,
          text: article.innerText.slice(0, 10000),
          url: window.location.href,
          favicon: document.querySelector('link[rel*="icon"]')?.href || '',
        };
      },
    });
    
    pageData = {
      type: detectType(tab.url),
      url: tab.url,
      title: result.result.title || tab.title,
      content_text: result.result.text,
      favicon: tab.favIconUrl || result.result.favicon,
    };
  } catch {
    pageData = {
      type: 'link',
      url: tab.url,
      title: tab.title,
      content_text: '',
      favicon: tab.favIconUrl,
    };
  }
});

function detectType(url) {
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'video';
  if (url.includes('twitter.com') || url.includes('x.com')) return 'link';
  if (url.includes('reddit.com')) return 'link';
  return 'article';
}

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
