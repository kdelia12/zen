// Filtering logic for Zen extension

const checkKeywordFiltering = (text) => {
  const lowerText = text.toLowerCase();
  if (blacklist.length > 0 && blacklist.some(k => lowerText.includes(k.toLowerCase()))) {
    return { shouldFilter: true, reason: 'Blacklisted keyword' };
  }
  if (allowlist.length > 0 && !allowlist.some(k => lowerText.includes(k.toLowerCase()))) {
    return { shouldFilter: true, reason: 'Not in allowlist' };
  }
  return { shouldFilter: false, reason: null };
};

const shouldFilterPost = async (postElement) => {
  if (isReply(postElement)) return { shouldFilter: false, reason: null };

  const tweetId = postElement.querySelector('a[href*="/status/"]')?.href?.match(/\/status\/(\d+)/)?.[1];
  const postId = tweetId || `${Date.now()}-${Math.random()}`;

  if (processedPosts.has(postId)) {
    const cached = processedPosts.get(postId);
    return typeof cached === 'boolean' ? { shouldFilter: cached, reason: 'Cached' } : cached;
  }

  const text = getPostText(postElement);
  await waitForImagesToLoad(postElement);
  const images = getPostImages(postElement);
  const username = getPostUsername(postElement);

  // 1. Account filters
  if (username) {
    if (accountBlacklist.length > 0 && accountBlacklist.includes(username)) {
      const r = { shouldFilter: true, reason: `Blacklisted @${username}` };
      processedPosts.set(postId, r);
      return r;
    }
    if (accountAllowlist.length > 0 && accountAllowlist.includes(username)) {
      processedPosts.set(postId, { shouldFilter: false, reason: null });
      return { shouldFilter: false, reason: null };
    }
  }

  // 2. Keyword filters
  if (enableKeywordFilter && (allowlist.length > 0 || blacklist.length > 0)) {
    const kr = checkKeywordFiltering(text);
    if (kr.shouldFilter) {
      processedPosts.set(postId, kr);
      return kr;
    }
    processedPosts.set(postId, { shouldFilter: false, reason: null });
    return { shouldFilter: false, reason: null };
  }

  // 3. Lock-in Mode
  if (lockInMode && text.trim().length > 0) {
    try {
      const res = await sendMessageWithRetry({ action: 'checkCrypto', text: text.substring(0, 1000) });
      if (res?.success && !res.result) {
        const r = { shouldFilter: true, reason: 'Non-crypto (Lock-in)' };
        processedPosts.set(postId, r);
        return r;
      }
      if (res?.success && res.result) {
        processedPosts.set(postId, { shouldFilter: false, reason: null });
        return { shouldFilter: false, reason: null };
      }
    } catch {}
  }

  // 4. Image filter
  if (enableImageFilter && images.length > 0) {
    for (const imageUrl of images) {
      try {
        let imageBase64 = null;
        try {
          const blob = await (await fetch(imageUrl)).blob();
          imageBase64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch {}
        const res = await sendMessageWithRetry({
          action: 'checkImage',
          imageUrl: imageBase64 ? null : imageUrl,
          imageBase64,
          postText: text,
          useFreeModeration: useFreeImageModeration
        });
        if (res?.success && res.result) {
          const r = { shouldFilter: true, reason: 'NSFW detected' };
          processedPosts.set(postId, r);
          return r;
        }
      } catch {}
    }
  }

  // 5. Credibility filter
  if (enableCredibilityFilter === true) {
    const score = getCredibilityBadge(postElement);
    if (score !== null && score < credibilityThreshold) {
      const r = { shouldFilter: true, reason: `Low credibility (${score})` };
      processedPosts.set(postId, r);
      return r;
    }
  }

  processedPosts.set(postId, { shouldFilter: false, reason: null });
  return { shouldFilter: false, reason: null };
};

const hidePost = (postElement, reason = 'filtered') => {
  if (postElement.hasAttribute('data-zen-replaced')) return;

  const username = getPostUsername(postElement);
  const tweetId = postElement.querySelector('a[href*="/status/"]')?.href?.match(/\/status\/(\d+)/)?.[1];
  const postId = tweetId || `${Date.now()}-${Math.random()}`;

  hiddenPostsContent.set(postId, postElement.innerHTML);
  postElement.setAttribute('data-zen-post-id', postId);
  postElement.setAttribute('data-zen-filtered', 'true');
  postElement.setAttribute('data-zen-replaced', 'true');

  const placeholder = document.createElement('div');
  placeholder.className = 'zen-hidden-post';
  placeholder.innerHTML = `
    <div class="zen-hidden-post-icon">🧘</div>
    <div class="zen-hidden-post-message">Post hidden by Zen</div>
    <div class="zen-hidden-post-reason">${username ? `@${username}` : 'Post'} · ${reason}</div>
    <button class="zen-show-button">
      <svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"></path></svg>
      Show
    </button>
  `;
  placeholder.querySelector('.zen-show-button').addEventListener('click', (e) => {
    e.stopPropagation();
    showPost(postElement);
  });

  postElement.innerHTML = '';
  postElement.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center';
  postElement.appendChild(placeholder);
};

const showPost = (postElement) => {
  const postId = postElement.getAttribute('data-zen-post-id');
  if (postId && hiddenPostsContent.has(postId)) {
    postElement.innerHTML = hiddenPostsContent.get(postId);
    hiddenPostsContent.delete(postId);
  }
  postElement.removeAttribute('data-zen-filtered');
  postElement.removeAttribute('data-zen-replaced');
  postElement.removeAttribute('data-zen-post-id');
  postElement.removeAttribute('data-zen-processing');
  postElement.removeAttribute('data-zen-observed');
  postElement.style.cssText = '';
};
