// OpenMemo Chrome Extension - Content Script

// Site-specific extractors
const extractors = {
  youtube: () => {
    const title = document.querySelector('h1.ytd-video-primary-info-renderer, h1.ytd-watch-metadata')?.textContent?.trim();
    const description = document.querySelector('#description-text, #description')?.textContent?.trim();
    return {
      type: 'video',
      title: title || document.title,
      content_text: description || '',
    };
  },

  twitter: () => {
    const tweets = document.querySelectorAll('article[data-testid="tweet"]');
    const texts = Array.from(tweets).map(t => t.innerText).join('\n\n---\n\n');
    return {
      type: 'link',
      title: document.title,
      content_text: texts || document.body.innerText.slice(0, 5000),
    };
  },

  reddit: () => {
    const title = document.querySelector('h1')?.textContent?.trim();
    const post = document.querySelector('[data-test-id="post-content"], .Post')?.innerText;
    return {
      type: 'link',
      title: title || document.title,
      content_text: post || document.body.innerText.slice(0, 5000),
    };
  },

  gmail: () => {
    const subject = document.querySelector('h2[data-thread-perm-id]')?.textContent?.trim();
    const body = document.querySelector('.a3s.aiL, .ii.gt')?.innerText;
    return {
      type: 'link',
      title: subject || document.title,
      content_text: body || '',
    };
  },

  chatgpt: () => {
    const messages = document.querySelectorAll('[data-message-author-role]');
    const conversation = Array.from(messages).map(m => {
      const role = m.getAttribute('data-message-author-role');
      return `**${role}:** ${m.innerText}`;
    }).join('\n\n');
    return {
      type: 'link',
      title: document.title,
      content_text: conversation || document.body.innerText.slice(0, 10000),
    };
  },

  generic: () => {
    const article = document.querySelector('article') || document.querySelector('main') || document.body;
    return {
      type: 'article',
      title: document.title,
      content_text: article.innerText.slice(0, 10000),
    };
  },
};

// Detect site and extract
function getExtractor() {
  const host = window.location.hostname;
  if (host.includes('youtube.com') || host.includes('youtu.be')) return extractors.youtube;
  if (host.includes('twitter.com') || host.includes('x.com')) return extractors.twitter;
  if (host.includes('reddit.com')) return extractors.reddit;
  if (host.includes('mail.google.com')) return extractors.gmail;
  if (host.includes('chat.openai.com') || host.includes('chatgpt.com')) return extractors.chatgpt;
  return extractors.generic;
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extract-content') {
    const extractor = getExtractor();
    const data = extractor();
    sendResponse({
      ...data,
      url: window.location.href,
      favicon: document.querySelector('link[rel*="icon"]')?.href || '',
    });
    return true;
  }
});
