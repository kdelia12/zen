// Utility functions for Zen extension

// Helper function to send message with retry (handles background worker not ready)
const sendMessageWithRetry = async (message, maxRetries = 2) => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await Promise.race([
        new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Message timeout'));
          }, 10000); // 10 second timeout

          chrome.runtime.sendMessage(message, (response) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) {
              const errorMsg = chrome.runtime.lastError.message;
              // If connection error, try to wait and retry
              if (errorMsg.includes('Receiving end does not exist') && attempt < maxRetries - 1) {
                console.log('[Zen] Background not ready, will retry', { attempt: attempt + 1, maxRetries });
                reject(new Error('RETRY'));
              } else {
                reject(new Error(errorMsg));
              }
            } else if (!response) {
              reject(new Error('No response received'));
            } else {
              resolve(response);
            }
          });
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout')), 10000)
        )
      ]);
    } catch (error) {
      if (error.message === 'RETRY' && attempt < maxRetries - 1) {
        // Wait a bit before retry (background worker might be starting)
        console.log('[Zen] Waiting before retry', { attempt: attempt + 1 });
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }
      throw error;
    }
  }
};

// Get post text content
const getPostText = (postElement) => {
  const textSelectors = [
    '[data-testid="tweetText"]',
    '[lang]',
    'div[dir="auto"]'
  ];

  for (const selector of textSelectors) {
    const textEl = postElement.querySelector(selector);
    if (textEl) {
      return textEl.textContent || textEl.innerText || '';
    }
  }

  // Fallback: get all text from post
  return postElement.textContent || postElement.innerText || '';
};

// Wait for images to load properly
const waitForImagesToLoad = (postElement) => {
  return new Promise((resolve) => {
    const images = Array.from(postElement.querySelectorAll('img'));

    if (images.length === 0) {
      console.log('[Zen] No images in post, proceeding immediately');
      resolve();
      return;
    }

    let loadedCount = 0;
    const totalImages = images.length;

    const checkComplete = () => {
      loadedCount++;
      console.log(`[Zen] Image loaded ${loadedCount}/${totalImages}`);
      if (loadedCount === totalImages) {
        console.log('[Zen] All images loaded');
        resolve();
      }
    };

    // Set timeout as fallback (max 2 seconds)
    const timeout = setTimeout(() => {
      console.log('[Zen] Image load timeout, proceeding anyway');
      resolve();
    }, 2000);

    images.forEach((img) => {
      if (img.complete && img.naturalHeight !== 0) {
        // Already loaded
        checkComplete();
      } else {
        // Wait for load
        img.addEventListener('load', () => {
          clearTimeout(timeout);
          checkComplete();
        }, { once: true });

        img.addEventListener('error', () => {
          console.warn('[Zen] Image failed to load:', img.src);
          clearTimeout(timeout);
          checkComplete();
        }, { once: true });
      }
    });
  });
};

// Get images from post
const getPostImages = (postElement) => {
  const images = [];

  // Try multiple selectors for Twitter's dynamic image loading
  const imgSelectors = [
    'img[src*="media"]',
    'img[src*="pbs.twimg.com/media"]',
    'img[alt*="Image"]',
    'div[data-testid="tweetPhoto"] img',
    'div[data-testid="tweet"] img',
    'a[href*="/photo/"] img',
    '[role="link"] img'
  ];

  const foundImages = new Set(); // Prevent duplicates

  for (const selector of imgSelectors) {
    const imgElements = postElement.querySelectorAll(selector);
    imgElements.forEach(img => {
      // Try multiple attributes for lazy loaded images
      const src = img.src || img.getAttribute('src') || img.getAttribute('data-src') || img.currentSrc;

      if (src && !foundImages.has(src)) {
        // Filter out profile pictures, emojis, icons
        const isMedia = src.includes('media') || src.includes('twimg.com');
        const notProfile = !src.includes('profile_images') && !src.includes('profile_banners');
        const notEmoji = !src.includes('emoji');
        const notIcon = !src.includes('icon') && !src.includes('svg');
        const notSmall = !src.includes('name=small') && !src.includes('name=tiny');

        if (isMedia && notProfile && notEmoji && notIcon && notSmall) {
          foundImages.add(src);
          images.push(src);
          console.log('[Zen] Found image:', src.substring(0, 80) + '...');
        }
      }
    });
  }

  console.log('[Zen] Total images found:', images.length);
  return images;
};

// Check if post is a reply (not main tweet)
// ULTRA SIMPLE & FAST - check early to save API calls & credits
// Check if post is a reply (not main tweet)
const isReply = (postElement) => {
  // Method 1: Check for "Replying to" text in specific header element
  // This avoids false positives where the user types "Replying to" in their tweet
  const headerText = Array.from(postElement.querySelectorAll('[data-testid="User-Name"]'))
    .map(el => el.textContent)
    .join(' ');

  if (headerText.includes('Replying to') || headerText.includes('Membalas')) {
    console.log('[Zen] ⏭️ REPLY DETECTED (Header text)');
    return true;
  }

  // Method 2: Check for vertical thread line (ancestor check)
  // Replies usually have a vertical line connecting them
  // We look for the specific class or structure that indicates a thread connector
  // This is tricky as classes change, but the structure often involves a specific width div

  // Method 3: Check if it's inside a conversation container that isn't the main tweet
  // Often replies are grouped

  // Method 4: Fallback to full text check but be careful
  const fullText = postElement.textContent || '';
  // "Replying to" at the START of the text is a strong indicator
  if (fullText.startsWith('Replying to') || fullText.startsWith('Membalas')) {
    console.log('[Zen] ⏭️ REPLY DETECTED (Starts with text)');
    return true;
  }

  // Method 5: Check for aria-label indicating reply
  // Sometimes the article or a parent has an aria-label like "Reply to..."

  return false;
};

// Get username from post
const getPostUsername = (postElement) => {
  // Try multiple selectors for username
  const usernameSelectors = [
    'a[href^="/"][href*="/status/"]',
    '[data-testid="User-Name"] a[href^="/"]',
    'a[role="link"][href^="/"]'
  ];

  for (const selector of usernameSelectors) {
    const links = postElement.querySelectorAll(selector);
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && href.startsWith('/') && !href.includes('/i/') && !href.includes('/compose/')) {
        // Extract username from href like "/username/status/123" or "/username"
        const match = href.match(/^\/([^\/]+)/);
        if (match && match[1]) {
          const username = match[1].toLowerCase();
          // Filter out Twitter system paths
          if (username !== 'home' && username !== 'explore' && username !== 'notifications' &&
            username !== 'messages' && username !== 'settings' && username !== 'compose') {
            console.log('[Zen] Extracted username:', username);
            return username;
          }
        }
      }
    }
  }

  console.log('[Zen] Could not extract username from post');
  return null;
};

// Get Ethos Network credibility badge score from post
// Returns null if badge not found, or the numeric score if found
// Structure: <div class="credibility-badge-point">1269</div>
const getCredibilityBadge = (postElement) => {
  // Primary selector: .credibility-badge-point (actual Ethos Network class)
  // The score is directly in the text content: <div class="credibility-badge-point">1269</div>
  const badgeSelectors = [
    '.credibility-badge-point', // Primary: actual Ethos Network class
    '.credibility-badge',
    '[data-credibility]',
    '[data-ethos-credibility]',
    '[class*="credibility"]',
    '[class*="ethos"]'
  ];

  for (const selector of badgeSelectors) {
    const badges = postElement.querySelectorAll(selector);

    if (badges.length > 0 && selector === '.credibility-badge-point') {
      // Found primary selector - process it
      for (const badge of badges) {
        // Method 1: Extract from text content (most common for .credibility-badge-point)
        // Structure: <div class="credibility-badge-point">1269</div>
        const text = (badge.textContent || badge.innerText || '').trim();

        if (text) {
          // Extract number from text (could be "1269" or "Credibility: 1269")
          const numberMatch = text.match(/\d+/);
          if (numberMatch) {
            const numScore = parseInt(numberMatch[0], 10);
            if (!isNaN(numScore) && numScore > 0) {
              return numScore;
            }
          }
        }
      }
    }

    // Fallback to other selectors
    for (const badge of badges) {
      // Method 2: Check data attributes
      const score = badge.getAttribute('data-credibility') ||
        badge.getAttribute('data-ethos-credibility') ||
        badge.getAttribute('data-score') ||
        badge.getAttribute('data-value');

      if (score) {
        const numScore = parseInt(score, 10);
        if (!isNaN(numScore) && numScore > 0) {
          return numScore;
        }
      }

      // Method 3: Extract from text content
      const text = (badge.textContent || badge.innerText || '').trim();
      if (text) {
        const numberMatch = text.match(/\d+/);
        if (numberMatch) {
          const numScore = parseInt(numberMatch[0], 10);
          if (!isNaN(numScore) && numScore > 0) {
            return numScore;
          }
        }
      }

      // Method 4: Check title attribute
      const title = badge.getAttribute('title') || '';
      if (title) {
        const titleMatch = title.match(/\d+/);
        if (titleMatch) {
          const numScore = parseInt(titleMatch[0], 10);
          if (!isNaN(numScore) && numScore > 0) {
            return numScore;
          }
        }
      }
    }
  }

  // Fallback: Search entire post for credibility-related text patterns
  const postText = postElement.textContent || '';
  const credibilityPatterns = [
    /credibility[:\s]+(\d+)/i,
    /cred[:\s]+(\d+)/i,
    /ethos[:\s]+(\d+)/i
  ];

  for (const pattern of credibilityPatterns) {
    const match = postText.match(pattern);
    if (match && match[1]) {
      const numScore = parseInt(match[1], 10);
      if (!isNaN(numScore) && numScore > 0) {
        return numScore;
      }
    }
  }

  return null;
};

