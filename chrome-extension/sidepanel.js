// OpenMemo Side Panel - Shows AI summary of current page

const DEFAULT_API_BASE = 'http://localhost:8091/api';

async function getApiBase() {
  const stored = await chrome.storage.sync.get('apiBase');
  return stored.apiBase || DEFAULT_API_BASE;
}

const contentEl = document.getElementById('content');

async function summarizeCurrentPage() {
  try {
    const API_BASE = await getApiBase();
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
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              summary += parsed.content;
              contentEl.innerHTML = formatSummary(summary);
            }
          } catch {}
        }
      }
    }
  } catch (err) {
    contentEl.innerHTML = `<p>Error: ${err.message}</p>`;
  }
}

function formatSummary(text) {
  // Convert markdown-like formatting to HTML
  return text
    .replace(/#{3}\s+(.+)/g, '<h3>$1</h3>')
    .replace(/#{2}\s+(.+)/g, '<h2>$1</h2>')
    .replace(/#{1}\s+(.+)/g, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^(.+)$/gm, (match) => {
      if (match.startsWith('- ') || match.startsWith('• ')) {
        return `<li>${match.slice(2)}</li>`;
      }
      return match;
    })
    .replace(/(<li>.+<\/li>)+/g, '<ul>$&</ul>')
    .replace(/<\/ul><ul>/g, '');
}

// Auto-summarize when panel opens
summarizeCurrentPage();
