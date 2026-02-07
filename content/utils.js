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
  // Method 1: Check for reply context element (most reliable)
  const replyContext = postElement.querySelector('[data-testid="socialContext"]');
  if (replyContext) {
    const text = replyContext.textContent || '';
    if (text.includes('Replying to') || text.includes('Membalas') || text.includes('replied')) return true;
  }

  // Method 2: Check for "Replying to" link which Twitter uses
  const replyLinks = postElement.querySelectorAll('a[href^="/"]');
  for (const link of replyLinks) {
    const parent = link.parentElement;
    if (parent?.textContent?.includes('Replying to') || parent?.textContent?.includes('Membalas')) return true;
  }

  // Method 3: Check header area
  const headerText = Array.from(postElement.querySelectorAll('[data-testid="User-Name"]')).map(el => el.textContent).join(' ');
  if (headerText.includes('Replying to') || headerText.includes('Membalas')) return true;

  // Method 4: Check for reply indicator in tweet structure
  // Replies often have a vertical line connecting to parent
  const hasThreadLine = postElement.querySelector('[data-testid="Tweet-User-Avatar"]')?.closest('div')?.previousElementSibling?.querySelector('div[style*="border"]');
  if (hasThreadLine) return true;

  // Method 5: Check if there's a "Show this thread" or thread context
  const threadIndicator = postElement.querySelector('[data-testid="tweet"] a[href*="/status/"]');
  if (threadIndicator) {
    const siblingText = threadIndicator.parentElement?.parentElement?.textContent || '';
    if (siblingText.includes('Show this thread') || siblingText.includes('Lihat thread')) return true;
  }

  // Method 6: Check aria-label for reply indication
  const article = postElement.closest('article') || postElement;
  const ariaLabel = article.getAttribute('aria-label') || '';
  if (ariaLabel.toLowerCase().includes('reply') || ariaLabel.toLowerCase().includes('replied')) return true;

  // Method 7: Full text fallback (less reliable but catches edge cases)
  const fullText = postElement.textContent || '';
  const firstLine = fullText.split('\n')[0] || '';
  if (firstLine.includes('Replying to') || firstLine.includes('Membalas')) return true;

  return false;
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
