// Utility functions for Zen extension

const sendMessageWithRetry = async (message, maxRetries = 2) => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await Promise.race([
        new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);
          chrome.runtime.sendMessage(message, (response) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) {
              if (chrome.runtime.lastError.message.includes('Receiving end does not exist') && attempt < maxRetries - 1) {
                reject(new Error('RETRY'));
              } else {
                reject(new Error(chrome.runtime.lastError.message));
              }
            } else if (!response) {
              reject(new Error('No response'));
            } else {
              resolve(response);
            }
          });
        })
      ]);
    } catch (error) {
      if (error.message === 'RETRY' && attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      throw error;
    }
  }
};

const getPostText = (postElement) => {
  const selectors = ['[data-testid="tweetText"]', '[lang]', 'div[dir="auto"]'];
  for (const selector of selectors) {
    const el = postElement.querySelector(selector);
    if (el) return el.textContent || '';
  }
  return postElement.textContent || '';
};

const waitForImagesToLoad = (postElement) => {
  return new Promise((resolve) => {
    const images = Array.from(postElement.querySelectorAll('img'));
    if (images.length === 0) { resolve(); return; }

    let loaded = 0;
    const timeout = setTimeout(resolve, 2000);
    const check = () => { if (++loaded === images.length) { clearTimeout(timeout); resolve(); } };

    images.forEach((img) => {
      if (img.complete && img.naturalHeight !== 0) check();
      else {
        img.addEventListener('load', () => { clearTimeout(timeout); check(); }, { once: true });
        img.addEventListener('error', () => { clearTimeout(timeout); check(); }, { once: true });
      }
    });
  });
};

const getPostImages = (postElement) => {
  const images = [];
  const found = new Set();
  const selectors = [
    'img[src*="media"]', 'img[src*="pbs.twimg.com/media"]', 'div[data-testid="tweetPhoto"] img',
    'a[href*="/photo/"] img'
  ];

  for (const selector of selectors) {
    postElement.querySelectorAll(selector).forEach(img => {
      const src = img.src || img.getAttribute('src') || img.currentSrc;
      if (src && !found.has(src)) {
        const isMedia = src.includes('media') || src.includes('twimg.com');
        const valid = !src.includes('profile_images') && !src.includes('emoji') && !src.includes('icon');
        if (isMedia && valid) { found.add(src); images.push(src); }
      }
    });
  }
  return images;
};

const isReply = (postElement) => {
  const headerText = Array.from(postElement.querySelectorAll('[data-testid="User-Name"]')).map(el => el.textContent).join(' ');
  if (headerText.includes('Replying to') || headerText.includes('Membalas')) return true;
  const fullText = postElement.textContent || '';
  return fullText.startsWith('Replying to') || fullText.startsWith('Membalas');
};

const getPostUsername = (postElement) => {
  const selectors = ['a[href^="/"][href*="/status/"]', '[data-testid="User-Name"] a[href^="/"]'];
  for (const selector of selectors) {
    for (const link of postElement.querySelectorAll(selector)) {
      const href = link.getAttribute('href');
      if (href?.startsWith('/') && !href.includes('/i/')) {
        const match = href.match(/^\/([^\/]+)/);
        if (match?.[1] && !['home', 'explore', 'notifications', 'messages', 'settings', 'compose'].includes(match[1])) {
          return match[1].toLowerCase();
        }
      }
    }
  }
  return null;
};

const getCredibilityBadge = (postElement) => {
  const selectors = ['.credibility-badge-point', '.credibility-badge', '[data-credibility]', '[class*="credibility"]'];
  for (const selector of selectors) {
    for (const badge of postElement.querySelectorAll(selector)) {
      const score = badge.getAttribute('data-credibility') || badge.getAttribute('data-score');
      if (score) { const n = parseInt(score, 10); if (!isNaN(n) && n > 0) return n; }
      const text = (badge.textContent || '').trim();
      const match = text.match(/\d+/);
      if (match) { const n = parseInt(match[0], 10); if (!isNaN(n) && n > 0) return n; }
    }
  }
  return null;
};
