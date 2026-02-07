// Agent mode functionality for Zen extension

// Agent mode intervals
let agentInterval = null;

// Find "not interested" button (titik tiga di kanan atas post)
const findNotInterestedButton = (postElement) => {
  console.log('[Zen] 🔍 Finding menu button (titik tiga) for post');

  // Twitter/X menu button selectors (titik tiga di kanan atas)
  // Priority order based on reliability
  const selectors = [
    'button[aria-label="More"]', // Most specific - exact match
    'button[aria-label*="more"]', // Case insensitive match
    'button[aria-label*="More"]', // Capitalized match
    '[data-testid="caret"]', // Alternative selector
    'div[aria-haspopup="menu"]',
    'button[aria-haspopup="menu"]'
  ];

  for (const selector of selectors) {
    const menuButton = postElement.querySelector(selector);
    if (menuButton) {
      console.log('[Zen] ✅ Found menu button (titik tiga) with selector:', selector);
      console.log('[Zen] Button aria-label:', menuButton.getAttribute('aria-label'));
      return menuButton;
    }
  }

  // Fallback: find all buttons and check aria-label manually
  console.log('[Zen] Primary selectors failed, trying fallback...');
  const allButtons = postElement.querySelectorAll('button, div[role="button"]');
  console.log('[Zen] Found', allButtons.length, 'buttons/clickable divs in post');

  for (let i = 0; i < allButtons.length; i++) {
    const button = allButtons[i];
    const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
    const testId = button.getAttribute('data-testid') || '';

    if (i < 15) { // Log first 15 buttons for debugging
      console.log(`[Zen] Button ${i}:`, {
        ariaLabel: button.getAttribute('aria-label'),
        testId,
        tag: button.tagName
      });
    }

    // Check if aria-label contains "more" (case insensitive)
    if (ariaLabel === 'more' || ariaLabel.includes('more') || testId === 'caret') {
      console.log('[Zen] ✅ Found menu button via fallback search!');
      console.log('[Zen] Match:', { ariaLabel: button.getAttribute('aria-label'), testId });
      return button;
    }
  }

  console.error('[Zen] ❌ Menu button NOT FOUND after trying', selectors.length, 'selectors and', allButtons.length, 'buttons');
  return null;
};

// Click "not interested" for a post
const clickNotInterested = async (postElement) => {
  console.log('[Zen] 🎯 ========== ATTEMPTING TO CLICK NOT INTERESTED ==========');

  const menuButton = findNotInterestedButton(postElement);
  if (!menuButton) {
    console.error('[Zen] ❌ Cannot proceed: Menu button (titik tiga) not found');
    return false;
  }

  try {
    // Scroll post into view
    console.log('[Zen] Scrolling post into view...');
    postElement.scrollIntoView({ behavior: 'instant', block: 'center' });
    await new Promise(resolve => setTimeout(resolve, 300));

    // Ensure menu button is visible
    menuButton.scrollIntoView({ behavior: 'instant', block: 'nearest' });
    await new Promise(resolve => setTimeout(resolve, 200));

    // Click menu button (titik tiga)
    console.log('[Zen] 1️⃣ Clicking menu button (titik tiga)...');
    console.log('[Zen] Menu button element:', menuButton);

    // Try multiple click methods
    try {
      menuButton.click();
    } catch (e) {
      console.warn('[Zen] Regular click failed, trying dispatchEvent');
      menuButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }

    console.log('[Zen] Waiting for menu to open (1500ms)...');
    await new Promise(resolve => setTimeout(resolve, 1500)); // Wait longer for menu

    // Find "Not interested in this post" option
    console.log('[Zen] 2️⃣ Looking for "Not interested in this post" in dropdown...');

    // Wait a bit more for menu to be fully rendered
    await new Promise(resolve => setTimeout(resolve, 300));

    // Get all clickable menu items - try multiple selectors
    let menuItems = [];

    // Try primary selector
    menuItems = Array.from(document.querySelectorAll('div[role="menuitem"]'));
    console.log('[Zen] Found', menuItems.length, 'items with role="menuitem"');

    // Try alternative selectors if primary fails
    if (menuItems.length === 0) {
      console.log('[Zen] Trying alternative menu selectors...');
      const altSelectors = [
        '[role="menu"] div[role="menuitem"]',
        '[data-testid="Dropdown"] div[role="menuitem"]',
        'div[role="menu"] > div',
        '[role="option"]'
      ];

      for (const selector of altSelectors) {
        const items = Array.from(document.querySelectorAll(selector));
        if (items.length > 0) {
          console.log('[Zen] Found', items.length, 'items with selector:', selector);
          menuItems = items;
          break;
        }
      }
    }

    if (menuItems.length === 0) {
      console.error('[Zen] ❌ No menu items found - menu did not open properly');
      document.body.click(); // Close any menu
      return false;
    }

    // Log all menu items for debugging
    console.log('[Zen] === ALL MENU ITEMS ===');
    menuItems.forEach((item, idx) => {
      const text = item.textContent?.trim() || '';
      const role = item.getAttribute('role') || '';
      const testId = item.getAttribute('data-testid') || '';
      const tabIndex = item.getAttribute('tabindex') || '';
      console.log(`[Zen] ${idx + 1}. "${text}" [role=${role}, testid=${testId}, tabindex=${tabIndex}]`);
    });

    // Find "Not interested in this post" - try multiple methods
    let notInterestedOption = null;

    // Method 1: Find by exact text "Not interested in this post"
    notInterestedOption = menuItems.find(el => {
      const text = el.textContent?.trim() || '';
      return text === 'Not interested in this post';
    });

    if (notInterestedOption) {
      console.log('[Zen] ✅ Found via exact match: "Not interested in this post"');
    }

    // Method 2: Find by text starting with "Not interested"
    if (!notInterestedOption) {
      console.log('[Zen] Trying match with "starts with Not interested"...');
      notInterestedOption = menuItems.find(el => {
        const text = el.textContent?.trim() || '';
        return text.startsWith('Not interested');
      });

      if (notInterestedOption) {
        console.log('[Zen] ✅ Found via starts-with match');
      }
    }

    // Method 3: Case-insensitive search
    if (!notInterestedOption) {
      console.log('[Zen] Trying case-insensitive search...');
      notInterestedOption = menuItems.find(el => {
        const text = (el.textContent || '').toLowerCase().trim();
        return text === 'not interested in this post' ||
          text.includes('not interested in this');
      });

      if (notInterestedOption) {
        console.log('[Zen] ✅ Found via case-insensitive match');
      }
    }

    // Method 4: Find first item (usually "Not interested in this post" is first)
    if (!notInterestedOption && menuItems.length > 0) {
      console.log('[Zen] Trying first menu item as fallback...');
      const firstItemText = menuItems[0].textContent?.toLowerCase() || '';
      if (firstItemText.includes('not interested') || firstItemText.includes('not') && firstItemText.includes('interested')) {
        notInterestedOption = menuItems[0];
        console.log('[Zen] ✅ Using first menu item (contains "not interested")');
      }
    }

    if (notInterestedOption) {
      console.log('[Zen] 3️⃣ ✅ FOUND "Not interested" option!');
      console.log('[Zen] Option text:', notInterestedOption.textContent?.trim());
      console.log('[Zen] Option element:', notInterestedOption);
      console.log('[Zen] Option role:', notInterestedOption.getAttribute('role'));
      console.log('[Zen] Option tabindex:', notInterestedOption.getAttribute('tabindex'));

      // Ensure element is visible
      notInterestedOption.scrollIntoView({ behavior: 'instant', block: 'nearest' });
      await new Promise(resolve => setTimeout(resolve, 200));

      // Try multiple click methods
      console.log('[Zen] Attempting to click "Not interested" option...');
      let clicked = false;

      // Method 1: Direct click
      try {
        console.log('[Zen] Try method 1: Direct click()');
        notInterestedOption.click();
        clicked = true;
        console.log('[Zen] ✅ Direct click succeeded');
      } catch (e) {
        console.warn('[Zen] Direct click failed:', e.message);
      }

      // Method 2: MouseEvent with more options
      if (!clicked) {
        try {
          console.log('[Zen] Try method 2: MouseEvent dispatch');
          const clickEvent = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true,
            composed: true
          });
          notInterestedOption.dispatchEvent(clickEvent);
          clicked = true;
          console.log('[Zen] ✅ MouseEvent dispatch succeeded');
        } catch (e) {
          console.warn('[Zen] MouseEvent dispatch failed:', e.message);
        }
      }

      // Method 3: PointerEvent (some sites use this)
      if (!clicked) {
        try {
          console.log('[Zen] Try method 3: PointerEvent dispatch');
          const pointerDown = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
          const pointerUp = new PointerEvent('pointerup', { bubbles: true, cancelable: true });
          notInterestedOption.dispatchEvent(pointerDown);
          notInterestedOption.dispatchEvent(pointerUp);
          notInterestedOption.click();
          clicked = true;
          console.log('[Zen] ✅ PointerEvent dispatch succeeded');
        } catch (e) {
          console.warn('[Zen] PointerEvent dispatch failed:', e.message);
        }
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      if (clicked) {
        console.log('[Zen] ✅ ========== SUCCESSFULLY CLICKED NOT INTERESTED ==========');
        return true;
      } else {
        console.error('[Zen] ❌ All click methods failed');
        document.body.click(); // Close menu
        return false;
      }
    }

    // Not found
    console.error('[Zen] ❌ "Not interested in this post" option NOT FOUND in any menu items');
    console.log('[Zen] Menu might be in wrong state or Twitter UI changed');

    // Close menu
    console.log('[Zen] Closing menu...');
    document.body.click();
    await new Promise(resolve => setTimeout(resolve, 300));
    return false;

  } catch (error) {
    console.error('[Zen] ❌ Error clicking not interested:', error);
    console.error('[Zen] Stack trace:', error.stack);
    return false;
  }
};

// Agent notification
const showAgentNotification = () => {
  let notification = document.querySelector('.zen-agent-notification');
  if (!notification) {
    notification = document.createElement('div');
    notification.className = 'zen-agent-notification';
    notification.innerHTML = `
      <svg viewBox="0 0 24 24"><g><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"></path></g></svg>
      Agent mode is activated, please release your hands
    `;
    document.body.appendChild(notification);
  }

  // Force reflow
  void notification.offsetWidth;

  requestAnimationFrame(() => {
    notification.classList.add('zen-show');
  });
};

const hideAgentNotification = () => {
  const notification = document.querySelector('.zen-agent-notification');
  if (notification) {
    notification.classList.remove('zen-show');
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 500);
  }
};

// Agent mode: auto-scroll and click
const startAgentMode = () => {
  console.log('[Zen] startAgentMode called', { agentActive, mode, enabled });

  if (agentActive) {
    console.log('[Zen] Agent already active, stopping first');
    stopAgentMode();
  }

  if (mode !== 'agent') {
    console.warn('[Zen] Agent mode not started: mode is not "agent"', { mode });
    return;
  }

  if (!enabled) {
    console.warn('[Zen] Agent mode not started: extension disabled', { enabled });
    return;
  }

  // BLOCK NOTIFICATIONS PAGE
  if (window.location.pathname.includes('/notifications')) {
    console.warn('[Zen] Agent mode blocked on notifications page');
    alert('Agent Mode cannot be used on the Notifications page. Please go to your Home timeline.');
    stopAgentMode();
    return;
  }

  console.log('[Zen] Starting agent mode', { scrollDelay, clickDelay, pauseDuration });
  agentActive = true;
  lastUserInteraction = Date.now();

  // Show notification
  showAgentNotification();

  // Monitor user interaction (only for manual scrolling, not our auto-scroll)
  let userScrolling = false;
  const handleUserInteraction = (e) => {
    // Skip if it's our own programmatic scroll
    if (e.type === 'scroll' && !userScrolling) {
      return;
    }
    lastUserInteraction = Date.now();
    console.log('[Zen] User interaction detected, pausing agent for', pauseDuration, 'ms');
  };

  // Track manual scroll
  let scrollTimeout;
  const handleScroll = (e) => {
    userScrolling = true;
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      userScrolling = false;
    }, 100);
    handleUserInteraction(e);
  };

  document.addEventListener('mousemove', handleUserInteraction, { passive: true });
  document.addEventListener('wheel', handleUserInteraction, { passive: true }); // Mouse wheel
  document.addEventListener('touchstart', handleUserInteraction, { passive: true }); // Touch
  document.addEventListener('keydown', handleUserInteraction); // Keyboard navigation
  document.addEventListener('scroll', handleScroll, { passive: true, capture: true });

  // Process posts one by one - more human-like
  console.log('[Zen] Setting up tweet-by-tweet processing');

  let currentTweetIndex = 0;
  let isProcessing = false;

  agentInterval = setInterval(async () => {
    if (!agentActive || !enabled) {
      console.log('[Zen] Agent skipped', { agentActive, enabled });
      return;
    }

    // Safety check: Stop if user navigates to notifications
    if (window.location.pathname.includes('/notifications')) {
      console.log('[Zen] User navigated to notifications, stopping agent');
      stopAgentMode();
      return;
    }

    if (isProcessing) {
      console.log('[Zen] Still processing previous tweet, waiting...');
      return;
    }

    const timeSinceInteraction = Date.now() - lastUserInteraction;
    if (timeSinceInteraction < pauseDuration) {
      console.log('[Zen] Agent paused (user interaction)', { timeSinceInteraction, pauseDuration });
      return;
    }

    isProcessing = true;

    try {
      // Get all visible tweets
      const allTweets = document.querySelectorAll('article[data-testid="tweet"]');
      console.log('[Zen] 📋 Found', allTweets.length, 'total tweets on page');

      if (allTweets.length === 0) {
        console.log('[Zen] No tweets found on page');
        isProcessing = false;
        return;
      }

      // Find next unprocessed tweet
      let currentTweet = null;
      let attempts = 0;
      const maxAttempts = allTweets.length;

      while (attempts < maxAttempts) {
        if (currentTweetIndex >= allTweets.length) {
          console.log('[Zen] Reached end of tweets, resetting to start');
          currentTweetIndex = 0;
        }

        currentTweet = allTweets[currentTweetIndex];

        // STRICT REPLY CHECK: Skip if already processed OR if it's a reply
        if (!currentTweet.hasAttribute('data-zen-processed')) {
          if (isReply(currentTweet)) {
            console.log('[Zen] ⏭️ Skipping reply in agent mode (Strict check)');
            currentTweet.setAttribute('data-zen-processed', 'true');
          } else {
            break; // Found unprocessed main tweet
          }
        }

        currentTweetIndex++;
        attempts++;
      }

      if (!currentTweet || currentTweet.hasAttribute('data-zen-processed') || isReply(currentTweet)) {
        console.log('[Zen] All main tweets processed, waiting for new tweets...');
        // Scroll down to load more tweets
        window.scrollBy({ top: 500, behavior: 'smooth' });
        currentTweetIndex = 0;
        isProcessing = false;
        return;
      }

      // Step 1: Scroll to tweet
      console.log('[Zen] 📍 Step 1: Scrolling to tweet', currentTweetIndex);
      currentTweet.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(resolve => setTimeout(resolve, Math.min(scrollDelay, 1000))); // Wait for scroll (max 1s)

      // Step 2: Check content
      console.log('[Zen] 🔍 Step 2: Checking tweet content...');
      const result = await shouldFilterPost(currentTweet);

      let shouldFilter;
      if (typeof result === 'boolean') {
        shouldFilter = result;
      } else {
        shouldFilter = result.shouldFilter;
      }

      console.log('[Zen] Filter result:', { shouldFilter, index: currentTweetIndex });

      if (shouldFilter) {
        // Step 3: Open menu
        console.log('[Zen] 📂 Step 3: Opening menu for filtered tweet...');
        await new Promise(resolve => setTimeout(resolve, clickDelay));

        // Step 4: Click not interested
        console.log('[Zen] 👆 Step 4: Clicking "Not interested"...');
        const clicked = await clickNotInterested(currentTweet);

        if (clicked) {
          console.log('[Zen] ✅ Successfully processed and removed tweet', currentTweetIndex);
        } else {
          console.warn('[Zen] ⚠️ Failed to click "Not interested" for tweet', currentTweetIndex);
        }

        await new Promise(resolve => setTimeout(resolve, clickDelay)); // Wait after action (use clickDelay)
      } else {
        console.log('[Zen] ✅ Tweet passed filters, skipping', currentTweetIndex);
        await new Promise(resolve => setTimeout(resolve, 500)); // Small delay before next
      }

      // Mark as processed
      currentTweet.setAttribute('data-zen-processed', 'true');

      // Move to next tweet
      currentTweetIndex++;
      console.log('[Zen] Moving to next tweet. Next index:', currentTweetIndex);

    } catch (error) {
      console.error('[Zen] Error in agent processing:', error);
    } finally {
      isProcessing = false;
    }

  }, clickDelay + 500); // Use clickDelay + 500ms for tweet-by-tweet interval

  console.log('[Zen] Agent mode started successfully', {
    agentActive,
    processInterval: !!agentInterval,
    settings: {
      scrollDelay,
      clickDelay,
      pauseDuration
    }
  });
};

const stopAgentMode = () => {
  console.log('[Zen] Stopping agent mode');
  agentActive = false;

  // Hide notification
  hideAgentNotification();

  if (agentInterval) {
    clearInterval(agentInterval);
    agentInterval = null;
    console.log('[Zen] Agent interval cleared');
  }
};



