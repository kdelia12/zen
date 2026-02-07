// Filtering logic for Zen extension
// Note: This file uses global variables from state.js and functions from utils.js
// They are loaded in order via manifest.json

// Check if post matches keywords
const checkKeywordFiltering = (text) => {
  const lowerText = text.toLowerCase();

  // Check blacklist first (highest priority)
  if (blacklist.length > 0) {
    const matchesBlacklist = blacklist.some(keyword =>
      lowerText.includes(keyword.toLowerCase())
    );
    if (matchesBlacklist) {
      return { shouldFilter: true, reason: 'Blacklisted keyword detected' };
    }
  }

  // Check allowlist (if allowlist is not empty)
  if (allowlist.length > 0) {
    const matchesAllowlist = allowlist.some(keyword =>
      lowerText.includes(keyword.toLowerCase())
    );
    if (!matchesAllowlist) {
      return { shouldFilter: true, reason: 'Not in allowlist' };
    }
  }

  // Pass all checks
  return { shouldFilter: false, reason: null };
};

// Check if post should be filtered
const shouldFilterPost = async (postElement) => {
  // Skip replies - only process main tweets
  if (isReply(postElement)) {
    console.log('[Zen] ⏭️ Skipping reply (only processing main tweets)');
    return { shouldFilter: false, reason: null };
  }

  // Generate unique post ID
  const tweetId = postElement.querySelector('a[href*="/status/"]')?.href?.match(/\/status\/(\d+)/)?.[1];
  const postId = tweetId ||
    postElement.getAttribute('data-testid') ||
    postElement.getAttribute('data-post-id') ||
    Array.from(postElement.querySelectorAll('[data-testid]'))[0]?.getAttribute('data-testid') ||
    `${Date.now()}-${Math.random()}`;

  // Use Map to store results with reason
  if (processedPosts.has(postId)) {
    const cached = processedPosts.get(postId);
    // Support both old format (boolean) and new format (object)
    if (typeof cached === 'boolean') {
      return { shouldFilter: cached, reason: 'Previously filtered' };
    } else if (cached && typeof cached.shouldFilter === 'boolean') {
      return cached;
    }
  }

  const text = getPostText(postElement);

  // Wait for images to load properly using event listeners
  await waitForImagesToLoad(postElement);

  const images = getPostImages(postElement);
  const username = getPostUsername(postElement);

  console.log('[Zen] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[Zen] 🔍 Processing post:', { username, textLength: text.length, imageCount: images.length });

  // ============================================
  // FILTERING HIERARCHY (Sequential):
  // 1. Allowlist/Blocklist Account & Keyword (if allowlist, bypass ALL filters)
  // 2. Lock-in Mode (Crypto detection)
  // 3. NSFW (Image filtering)
  // 4. Ethos Score (Credibility badge)
  // ============================================

  // ============================================
  // STEP 1: Account & Keyword Allowlist/Blacklist
  // ============================================
  // Account filters
  if (username) {
    // Account blacklist - ALWAYS hide
    if (accountBlacklist.length > 0 && accountBlacklist.includes(username)) {
      console.log('[Zen] 🔴 STEP 1: ACCOUNT BLACKLIST → FILTERED');
      processedPosts.set(postId, { shouldFilter: true, reason: `Account blacklisted (@${username})` });
      return { shouldFilter: true, reason: `Account blacklisted (@${username})` };
    }

    // Account allowlist - ALWAYS show (bypass ALL other filters)
    if (accountAllowlist.length > 0 && accountAllowlist.includes(username)) {
      console.log('[Zen] ✅ STEP 1: ACCOUNT ALLOWLIST → BYPASS ALL');
      processedPosts.set(postId, { shouldFilter: false, reason: null });
      return { shouldFilter: false, reason: null };
    }
  }

  // Keyword filters
  if (enableKeywordFilter && (allowlist.length > 0 || blacklist.length > 0)) {
    const keywordResult = checkKeywordFiltering(text);

    if (keywordResult.shouldFilter) {
      // Check if it's blacklist (always hide) or allowlist (not in allowlist = hide)
      console.log('[Zen] 🔴 STEP 1: KEYWORD FILTER → FILTERED');
      processedPosts.set(postId, keywordResult);
      return keywordResult;
    } else {
      // Keyword allowlist passed - bypass ALL other filters
      console.log('[Zen] ✅ STEP 1: KEYWORD ALLOWLIST → BYPASS ALL');
      processedPosts.set(postId, { shouldFilter: false, reason: null });
      return { shouldFilter: false, reason: null };
    }
  }

  if (!enableKeywordFilter || (allowlist.length === 0 && blacklist.length === 0)) {
    console.log('[Zen] ⏭️ STEP 1: Keyword filter disabled → SKIP');
  }

  // ============================================
  // STEP 2: Lock-in Mode (Crypto Detection) - SEQUENTIAL
  // ============================================
  if (lockInMode) {
    try {
      if (text.trim().length > 0) {
        // AWAIT crypto check sequentially
        const response = await sendMessageWithRetry({
          action: 'checkCrypto',
          text: text.substring(0, 1000) // Limit text length
        });

        if (response?.success) {
          const isCrypto = response.result;

          if (!isCrypto) {
            // Lock-in mode: hide NON-crypto posts
            console.log('[Zen] 🔴 STEP 2: NON-CRYPTO → FILTERED');
            processedPosts.set(postId, { shouldFilter: true, reason: 'Non-crypto content (Lock-in mode)' });
            return { shouldFilter: true, reason: 'Non-crypto content (Lock-in mode)' };
          } else {
            console.log('[Zen] ✅ STEP 2: CRYPTO → PASSED (Bypassing subsequent filters)');
            processedPosts.set(postId, { shouldFilter: false, reason: null });
            return { shouldFilter: false, reason: null };
          }
        } else {
          console.log('[Zen] ⚠️ STEP 2: Crypto check failed → PASSED (fail open)');
        }
      } else {
        console.log('[Zen] ⏭️ STEP 2: No text → PASSED');
      }
    } catch (error) {
      console.log('[Zen] ⚠️ STEP 2: Error → PASSED (fail open)');
      // Don't filter on error (fail open)
    }
  } else {
    console.log('[Zen] ⏭️ STEP 2: Lock-in Mode disabled → SKIP');
  }

  // ============================================
  // STEP 3: NSFW (Image Filtering) - SEQUENTIAL
  // ============================================
  if (enableImageFilter) {
    // Check each image SEQUENTIALLY (one by one, await each)
    if (images.length > 0) {
      for (let i = 0; i < images.length; i++) {
        const imageUrl = images[i];
        try {
          // Fetch image and convert to base64 (needed for both free and paid APIs)
          let imageBase64 = null;
          try {
            const imgResponse = await fetch(imageUrl);
            const blob = await imgResponse.blob();
            imageBase64 = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                const base64 = reader.result.split(',')[1];
                resolve(base64);
              };
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          } catch (fetchError) {
            // If fetch fails, try sending URL directly
          }

          // AWAIT each image check sequentially
          const response = await sendMessageWithRetry({
            action: 'checkImage',
            imageUrl: imageBase64 ? null : imageUrl,
            imageBase64,
            postText: text,
            useFreeModeration: useFreeImageModeration
          });

          if (response?.success && response.result) {
            console.log('[Zen] 🔴 STEP 3: NSFW DETECTED → FILTERED');
            processedPosts.set(postId, { shouldFilter: true, reason: 'NSFW/Thirst trap image detected' });
            return { shouldFilter: true, reason: 'NSFW/Thirst trap image detected' };
          }
        } catch (error) {
          // Continue to next image on error (fail open)
        }
      }
      console.log('[Zen] ✅ STEP 3: NSFW CHECK → PASSED');
    } else if (useFreeImageModeration && text.trim().length > 0) {
      // If no images but using free moderation, check post text as fallback
      try {
        const response = await sendMessageWithRetry({
          action: 'checkImage',
          imageUrl: null,
          imageBase64: null,
          postText: text,
          useFreeModeration: true
        });

        if (response?.success && response.result) {
          console.log('[Zen] 🔴 STEP 3: NSFW TEXT → FILTERED');
          processedPosts.set(postId, { shouldFilter: true, reason: 'NSFW text content detected' });
          return { shouldFilter: true, reason: 'NSFW text content detected' };
        } else {
          console.log('[Zen] ✅ STEP 3: NSFW TEXT CHECK → PASSED');
        }
      } catch (error) {
        console.log('[Zen] ⚠️ STEP 3: NSFW CHECK ERROR → PASSED (fail open)');
      }
    } else {
      console.log('[Zen] ⏭️ STEP 3: No images → SKIP');
    }
  } else {
    console.log('[Zen] ⏭️ STEP 3: Image filter disabled → SKIP');
  }

  // ============================================
  // STEP 4: Ethos Score (Credibility Badge)
  // ============================================
  if (typeof enableCredibilityFilter !== 'undefined' && enableCredibilityFilter === true) {
    const credibilityScore = getCredibilityBadge(postElement);

    if (credibilityScore !== null) {
      // Badge found - check if below threshold
      if (credibilityScore < credibilityThreshold) {
        console.log('[Zen] 🔴 STEP 4: LOW CREDIBILITY → FILTERED');
        processedPosts.set(postId, { shouldFilter: true, reason: `Low credibility badge (${credibilityScore} < ${credibilityThreshold})` });
        return { shouldFilter: true, reason: `Low credibility badge (${credibilityScore} < ${credibilityThreshold})` };
      } else {
        console.log('[Zen] ✅ STEP 4: CREDIBILITY CHECK → PASSED');
      }
    } else {
      // No badge found - allow post (fail open)
      console.log('[Zen] ⚠️ STEP 4: No badge → PASSED (fail open)');
    }
  } else {
    console.log('[Zen] ⏭️ STEP 4: Credibility filter disabled → SKIP');
  }

  // ============================================
  // ALL FILTERS PASSED
  // ============================================
  console.log('[Zen] ✅ ALL FILTERS PASSED → SHOW POST');
  processedPosts.set(postId, { shouldFilter: false, reason: null });
  return { shouldFilter: false, reason: null };
};

// Hide post (default mode) - replace content with reason and Show button
const hidePost = (postElement, reason = 'filtered content') => {
  // Check if already replaced
  if (postElement.hasAttribute('data-zen-replaced')) {
    return;
  }

  // Get username for display
  const username = getPostUsername(postElement);
  const displayUsername = username ? `@${username}` : 'Unknown user';

  // Generate unique ID for this post
  const tweetId = postElement.querySelector('a[href*="/status/"]')?.href?.match(/\/status\/(\d+)/)?.[1];
  const postId = tweetId ||
    postElement.getAttribute('data-testid') ||
    `${Date.now()}-${Math.random()}`;

  // Save original content in Map (more reliable than data attribute for complex HTML)
  const originalContent = postElement.innerHTML;
  hiddenPostsContent.set(postId, originalContent);
  postElement.setAttribute('data-zen-post-id', postId);
  postElement.setAttribute('data-zen-filtered', 'true');
  postElement.setAttribute('data-zen-replaced', 'true');

  // Create placeholder container
  const placeholder = document.createElement('div');
  placeholder.className = 'zen-hidden-post';

  // Create icon
  const icon = document.createElement('div');
  icon.className = 'zen-hidden-post-icon';
  icon.textContent = '🧘';

  // Create message text
  const messageText = document.createElement('div');
  messageText.className = 'zen-hidden-post-message';
  messageText.textContent = 'Post hidden by Zen';

  // Create username/reason text
  const reasonText = document.createElement('div');
  reasonText.className = 'zen-hidden-post-reason';
  reasonText.textContent = `Hidden post from ${displayUsername} · ${reason}`;

  // Create Show button
  const showButton = document.createElement('button');
  showButton.className = 'zen-show-button';
  showButton.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true"><g><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"></path></g></svg>
    Show Post
  `;

  // Click handler to show post
  showButton.addEventListener('click', (e) => {
    e.stopPropagation();
    showPost(postElement);
  });

  // Assemble placeholder
  placeholder.appendChild(icon);
  placeholder.appendChild(messageText);
  placeholder.appendChild(reasonText);
  placeholder.appendChild(showButton);

  // Replace post content - ensure proper centering
  postElement.innerHTML = '';
  postElement.style.display = 'flex';
  postElement.style.flexDirection = 'column';
  postElement.style.alignItems = 'center';
  postElement.style.justifyContent = 'center';
  postElement.appendChild(placeholder);

  console.log('[Zen] ✅ Post hidden and replaced with placeholder:', reason, 'from', displayUsername);
};

// Show post - restore original content
const showPost = (postElement) => {
  // Get post ID
  const postId = postElement.getAttribute('data-zen-post-id');

  if (postId && hiddenPostsContent.has(postId)) {
    // Restore original content from Map
    const originalContent = hiddenPostsContent.get(postId);
    postElement.innerHTML = originalContent;

    // Remove from Map to free memory
    hiddenPostsContent.delete(postId);

    // Remove attributes
    postElement.removeAttribute('data-zen-filtered');
    postElement.removeAttribute('data-zen-replaced');
    postElement.removeAttribute('data-zen-post-id');

    // Reset inline styles added by hidePost
    postElement.style.display = '';
    postElement.style.flexDirection = '';
    postElement.style.alignItems = '';
    postElement.style.justifyContent = '';

    // Mark as not processed so it can be re-processed if needed
    postElement.removeAttribute('data-zen-processing');
    postElement.removeAttribute('data-zen-observed');

    console.log('[Zen] ✅ Post shown and restored');
  } else {
    // Fallback: just remove attributes (content might be lost)
    postElement.removeAttribute('data-zen-filtered');
    postElement.removeAttribute('data-zen-replaced');
    postElement.removeAttribute('data-zen-post-id');
    console.log('[Zen] ✅ Post shown (no original content to restore - may need page refresh)');
  }
};

