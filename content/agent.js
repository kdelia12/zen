// Agent mode functionality for Zen extension

let agentInterval = null;

const findNotInterestedButton = (postElement) => {
  const selectors = ['button[aria-label="More"]', 'button[aria-label*="more"]', '[data-testid="caret"]', 'div[aria-haspopup="menu"]'];
  for (const selector of selectors) {
    const btn = postElement.querySelector(selector);
    if (btn) return btn;
  }
  for (const btn of postElement.querySelectorAll('button, div[role="button"]')) {
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    if (label === 'more' || label.includes('more')) return btn;
  }
  return null;
};

const clickNotInterested = async (postElement) => {
  const menuButton = findNotInterestedButton(postElement);
  if (!menuButton) return false;

  try {
    postElement.scrollIntoView({ behavior: 'instant', block: 'center' });
    await new Promise(r => setTimeout(r, 300));
    menuButton.click();
    await new Promise(r => setTimeout(r, 1500));

    let menuItems = Array.from(document.querySelectorAll('div[role="menuitem"]'));
    if (menuItems.length === 0) {
      for (const sel of ['[role="menu"] div[role="menuitem"]', 'div[role="menu"] > div']) {
        menuItems = Array.from(document.querySelectorAll(sel));
        if (menuItems.length > 0) break;
      }
    }
    if (menuItems.length === 0) { document.body.click(); return false; }

    let option = menuItems.find(el => el.textContent?.trim() === 'Not interested in this post');
    if (!option) option = menuItems.find(el => el.textContent?.toLowerCase().includes('not interested'));

    if (option) {
      option.scrollIntoView({ behavior: 'instant', block: 'nearest' });
      await new Promise(r => setTimeout(r, 200));
      option.click();
      await new Promise(r => setTimeout(r, 500));
      return true;
    }

    document.body.click();
    return false;
  } catch {
    return false;
  }
};

const showAgentNotification = () => {
  let n = document.querySelector('.zen-agent-notification');
  if (!n) {
    n = document.createElement('div');
    n.className = 'zen-agent-notification';
    n.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"></path></svg>Agent mode active`;
    document.body.appendChild(n);
  }
  requestAnimationFrame(() => n.classList.add('zen-show'));
};

const hideAgentNotification = () => {
  const n = document.querySelector('.zen-agent-notification');
  if (n) { n.classList.remove('zen-show'); setTimeout(() => n.remove(), 500); }
};

const startAgentMode = () => {
  if (agentActive) stopAgentMode();
  if (mode !== 'agent' || !enabled) return;
  if (window.location.pathname.includes('/notifications')) {
    alert('Agent Mode blocked on notifications page.');
    return;
  }

  agentActive = true;
  lastUserInteraction = Date.now();
  showAgentNotification();

  const handleInteraction = () => { lastUserInteraction = Date.now(); };
  document.addEventListener('mousemove', handleInteraction, { passive: true });
  document.addEventListener('wheel', handleInteraction, { passive: true });
  document.addEventListener('keydown', handleInteraction);

  let idx = 0, processing = false;

  agentInterval = setInterval(async () => {
    if (!agentActive || !enabled || processing) return;
    if (window.location.pathname.includes('/notifications')) { stopAgentMode(); return; }
    if (Date.now() - lastUserInteraction < pauseDuration) return;

    processing = true;
    try {
      const tweets = document.querySelectorAll('article[data-testid="tweet"]');
      if (tweets.length === 0) { processing = false; return; }

      let tweet = null;
      for (let i = 0; i < tweets.length; i++) {
        if (idx >= tweets.length) idx = 0;
        const t = tweets[idx];
        if (!t.hasAttribute('data-zen-processed')) {
          if (isReply(t)) t.setAttribute('data-zen-processed', 'true');
          else { tweet = t; break; }
        }
        idx++;
      }

      if (!tweet) {
        window.scrollBy({ top: 500, behavior: 'smooth' });
        idx = 0;
        processing = false;
        return;
      }

      tweet.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(r => setTimeout(r, Math.min(scrollDelay, 1000)));

      const result = await shouldFilterPost(tweet);
      const shouldFilter = typeof result === 'boolean' ? result : result.shouldFilter;

      if (shouldFilter) {
        await new Promise(r => setTimeout(r, clickDelay));
        await clickNotInterested(tweet);
        await new Promise(r => setTimeout(r, clickDelay));
      } else {
        await new Promise(r => setTimeout(r, 500));
      }

      tweet.setAttribute('data-zen-processed', 'true');
      idx++;
    } catch (e) {
      console.error('[Zen] Agent error:', e.message);
    } finally {
      processing = false;
    }
  }, clickDelay + 500);
};

const stopAgentMode = () => {
  agentActive = false;
  hideAgentNotification();
  if (agentInterval) { clearInterval(agentInterval); agentInterval = null; }
};
