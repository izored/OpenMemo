// OpenMemo Chrome Extension - Content Script
// Defuddle-style extraction from the LIVE rendered DOM (works on SPA /
// bot-walled sites where a server fetch returns nothing).

function absUrl(u) {
  try { return new URL(u, document.baseURI).href; } catch { return u || ''; }
}

function meta(...names) {
  for (const n of names) {
    const el =
      document.querySelector(`meta[property="${n}" i]`) ||
      document.querySelector(`meta[name="${n}" i]`);
    const c = el?.getAttribute('content')?.trim();
    if (c) return c;
  }
  return '';
}

// schema.org JSON-LD: image | thumbnailUrl as string | {url} | [..]
function schemaImage() {
  const blocks = document.querySelectorAll('script[type="application/ld+json"]');
  for (const b of blocks) {
    let data;
    try { data = JSON.parse(b.textContent); } catch { continue; }
    const stack = Array.isArray(data) ? [...data] : [data];
    while (stack.length) {
      const o = stack.pop();
      if (!o || typeof o !== 'object') continue;
      const img = o.image || o.thumbnailUrl;
      if (img) {
        if (typeof img === 'string') return img;
        if (Array.isArray(img) && img.length)
          return typeof img[0] === 'string' ? img[0] : img[0]?.url || '';
        if (img.url) return img.url;
      }
      for (const v of Object.values(o)) {
        if (v && typeof v === 'object') stack.push(v);
      }
    }
  }
  return '';
}

// Defuddle image priority: og:image -> twitter:image -> schema -> hero <img>
function pickImage(root) {
  const c =
    meta('og:image', 'og:image:url') ||
    meta('twitter:image', 'twitter:image:src') ||
    schemaImage() ||
    document.querySelector('link[rel="image_src"]')?.href ||
    '';
  if (c) return absUrl(c);
  let best = '', area = 0;
  for (const img of (root || document.body).querySelectorAll('img')) {
    const src = img.currentSrc || img.src;
    if (!src || src.startsWith('data:')) continue;
    const a = (img.naturalWidth || 0) * (img.naturalHeight || 0);
    if (a >= area) { area = a; best = src; }
  }
  return best ? absUrl(best) : '';
}

const JUNK = 'script,style,noscript,iframe,svg,form,button,nav,footer,aside,header,' +
  '[role="navigation"],[role="banner"],[role="contentinfo"],[aria-hidden="true"],' +
  '.nav,.navbar,.menu,.sidebar,.footer,.header,.comments,.share,.social,.related,' +
  '.newsletter,.cookie,.ad,.ads,.advert,.promo,.popup,.modal';

function contentRoot() {
  return (
    document.querySelector('article') ||
    document.querySelector('main') ||
    document.querySelector('[role="main"]') ||
    document.body
  );
}

// Minimal, dependency-free HTML -> Markdown for the cleaned content node.
function toMarkdown(node) {
  const lines = [];
  const inline = (el) => {
    let s = '';
    el.childNodes.forEach((n) => {
      if (n.nodeType === 3) s += n.textContent;
      else if (n.nodeType === 1) {
        const t = n.tagName;
        if (t === 'A') s += `[${n.textContent.trim()}](${absUrl(n.getAttribute('href') || '')})`;
        else if (t === 'IMG') {
          const src = n.currentSrc || n.getAttribute('src');
          if (src && !src.startsWith('data:')) s += `![${n.alt || ''}](${absUrl(src)})`;
        } else if (t === 'STRONG' || t === 'B') s += `**${inline(n)}**`;
        else if (t === 'EM' || t === 'I') s += `*${inline(n)}*`;
        else if (t === 'CODE') s += `\`${n.textContent}\``;
        else if (t === 'BR') s += '\n';
        else s += inline(n);
      }
    });
    return s;
  };
  const walk = (el) => {
    el.childNodes.forEach((n) => {
      if (n.nodeType !== 1) return;
      const t = n.tagName;
      if (/^H[1-6]$/.test(t)) lines.push('\n' + '#'.repeat(+t[1]) + ' ' + n.textContent.trim() + '\n');
      else if (t === 'P') lines.push(inline(n).trim() + '\n');
      else if (t === 'IMG') { const m = inline(n); if (m) lines.push(m + '\n'); }
      else if (t === 'PRE') lines.push('```\n' + n.textContent.trim() + '\n```\n');
      else if (t === 'BLOCKQUOTE') lines.push('> ' + n.textContent.trim() + '\n');
      else if (t === 'UL' || t === 'OL') {
        [...n.children].forEach((li, i) =>
          lines.push((t === 'OL' ? `${i + 1}. ` : '- ') + inline(li).trim()));
        lines.push('');
      } else if (['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'FIGURE'].includes(t)) walk(n);
      else { const s = inline(n).trim(); if (s) lines.push(s + '\n'); }
    });
  };
  walk(node);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function extractGeneric() {
  const root = contentRoot();
  const clone = root.cloneNode(true);
  clone.querySelectorAll(JUNK).forEach((e) => e.remove());
  const md = toMarkdown(clone);
  return {
    type: 'article',
    title: meta('og:title') || document.title,
    description: meta('description', 'og:description', 'twitter:description'),
    content_text: md || (root.innerText || '').slice(0, 20000),
    thumbnail: pickImage(root),
  };
}

const extractors = {
  youtube: () => ({
    type: 'video',
    title: meta('og:title') ||
      document.querySelector('h1.ytd-watch-metadata')?.textContent?.trim() ||
      document.title,
    description: meta('og:description') ||
      document.querySelector('#description-text, #description')?.textContent?.trim() || '',
    content_text: document.querySelector('#description-text, #description')?.textContent?.trim() ||
      meta('og:description') || '',
    thumbnail: pickImage(),
  }),

  twitter: () => {
    const tweets = document.querySelectorAll('article[data-testid="tweet"]');
    const texts = Array.from(tweets).map((t) => t.innerText).join('\n\n---\n\n');
    return {
      type: 'link',
      title: document.title,
      description: meta('og:description', 'description'),
      content_text: texts || document.body.innerText.slice(0, 5000),
      thumbnail: pickImage(),
    };
  },

  generic: extractGeneric,
};

function getExtractor() {
  const host = window.location.hostname;
  if (host.includes('youtube.com') || host.includes('youtu.be')) return extractors.youtube;
  if (host.includes('twitter.com') || host.includes('x.com')) return extractors.twitter;
  return extractors.generic;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extract-content') {
    let data;
    try {
      data = getExtractor()();
    } catch (e) {
      data = { type: 'article', title: document.title, content_text: '', thumbnail: '' };
    }
    sendResponse({
      ...data,
      url: window.location.href,
      favicon:
        document.querySelector('link[rel*="icon"]')?.href ||
        `https://www.google.com/s2/favicons?domain=${location.hostname}&sz=64`,
    });
    return true;
  }
});
