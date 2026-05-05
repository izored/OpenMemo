// OpenMemo Side Panel - Shows AI summary of current page

const API_BASE = 'http://openmemo.local/api';
const contentEl = document.getElementById('content');

async function summarizeCurrentPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Extract page content
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const article = document.querySelector('article') || document.querySelector('main') || document.body;
        return article.innerText.slice(0, 5000);
      },
    });
    
    const text = result.result;
    if (!text) {
      contentEl.innerHTML = '<p>No content found on this page.</p>';
      return;
    }

    // Request summary from API
    const response = await fetch(`${API_BASE}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `Summarize the following content in 3-5 key bullet points:\n\n${text}`,
        use_rag: false,
      }),
    });

    if (!response.ok) {
      contentEl.innerHTML = `<p>Error: ${response.status} ${response.statusText}</p>`;
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let summary = '';
    
    contentEl.innerHTML = '<h2>AI Summary</h2><p id="summary-text"></p>';
    const summaryEl = document.getElementById('summary-text');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'token') {
            summary += data.data;
            summaryEl.textContent = summary;
          }
        } catch {}
      }
    }
  } catch (err) {
    contentEl.innerHTML = `<p>Error: ${err.message}. Make sure OpenMemo server is running.</p>`;
  }
}

summarizeCurrentPage();

// Re-summarize when tab changes
chrome.tabs.onActivated.addListener(() => {
  contentEl.innerHTML = '<div class="loading">Generating summary...</div>';
  summarizeCurrentPage();
});
