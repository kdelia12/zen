// Popup script for Zen extension

document.addEventListener('DOMContentLoaded', async () => {
  const enableToggle = document.getElementById('enableToggle');
  const statusText = document.getElementById('statusText');
  const statusBadge = document.getElementById('statusBadge');
  const powerContainer = document.getElementById('powerContainer');
  const modeDefault = document.getElementById('modeDefault');
  const modeAgent = document.getElementById('modeAgent');
  const optionsLink = document.getElementById('optionsLink');

  // Load current settings
  const loadSettings = async () => {
    const result = await chrome.storage.local.get(['enabled', 'mode']);
    const enabled = result.enabled === true; // Default to false
    const mode = result.mode || 'default';

    enableToggle.checked = enabled;

    if (mode === 'agent') {
      modeAgent.checked = true;
    } else {
      modeDefault.checked = true;
    }

    updateStatus(enabled);
  };

  const updateStatus = (enabled) => {
    if (enabled) {
      statusText.textContent = 'Extension Enabled';
      statusBadge.textContent = 'Active';
      statusBadge.classList.add('active');
      statusBadge.classList.remove('inactive');
      powerContainer.classList.add('active');
    } else {
      statusText.textContent = 'Extension Disabled';
      statusBadge.textContent = 'Inactive';
      statusBadge.classList.add('inactive');
      statusBadge.classList.remove('active');
      powerContainer.classList.remove('active');
    }
  };

  // Helper function to safely send message to content script
  const safeSendMessage = async (tabId, message) => {
    try {
      return await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            // Content script not ready or tab closed - this is normal
            console.log('[Zen Popup] Content script not ready:', lastError.message);
            resolve(false); // Don't reject, just resolve as false
          } else {
            resolve(true);
          }
        });
      });
    } catch (error) {
      console.log('[Zen Popup] Error sending message:', error);
      return false;
    }
  };

  // Toggle enable/disable
  enableToggle.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    await chrome.storage.local.set({ enabled });
    updateStatus(enabled);

    // Notify content script if on Twitter/X
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && (tab.url?.includes('twitter.com') || tab.url?.includes('x.com'))) {
        await safeSendMessage(tab.id, { action: 'toggle', enabled });
      }
    } catch (error) {
      console.log('[Zen Popup] Could not notify tab:', error.message);
    }
  });

  // Mode selection
  const handleModeChange = async (mode) => {
    await chrome.storage.local.set({ mode });

    // Notify content script if on Twitter/X
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && (tab.url?.includes('twitter.com') || tab.url?.includes('x.com'))) {
        await safeSendMessage(tab.id, { action: 'modeChange', mode });
      }
    } catch (error) {
      console.log('[Zen Popup] Could not notify tab:', error.message);
    }
  };

  modeDefault.addEventListener('change', () => handleModeChange('default'));
  modeAgent.addEventListener('change', () => handleModeChange('agent'));

  // Options link
  optionsLink.addEventListener('click', (e) => {
    e.preventDefault();
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options.html'));
    }
  });

  // Load settings on popup open
  loadSettings();
});
