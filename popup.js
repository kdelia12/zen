// Popup script for Zen extension

document.addEventListener('DOMContentLoaded', async () => {
  const enableToggle = document.getElementById('enableToggle');
  const statusText = document.getElementById('statusText');
  const statusBadge = document.getElementById('statusBadge');
  const powerContainer = document.getElementById('powerContainer');
  const modeDefault = document.getElementById('modeDefault');
  const modeAgent = document.getElementById('modeAgent');
  const optionsLink = document.getElementById('optionsLink');

  const loadSettings = async () => {
    const result = await chrome.storage.local.get(['enabled', 'mode']);
    enableToggle.checked = result.enabled === true;
    (result.mode === 'agent' ? modeAgent : modeDefault).checked = true;
    updateStatus(result.enabled === true);
  };

  const updateStatus = (enabled) => {
    statusText.textContent = enabled ? 'Extension Enabled' : 'Extension Disabled';
    statusBadge.textContent = enabled ? 'Active' : 'Inactive';
    statusBadge.classList.toggle('active', enabled);
    statusBadge.classList.toggle('inactive', !enabled);
    powerContainer.classList.toggle('active', enabled);
  };

  const safeSendMessage = async (tabId, message) => {
    try {
      return await new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, message, () => resolve(!chrome.runtime.lastError));
      });
    } catch { return false; }
  };

  enableToggle.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    await chrome.storage.local.set({ enabled });
    updateStatus(enabled);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url?.includes('twitter.com') || tab?.url?.includes('x.com')) {
        await safeSendMessage(tab.id, { action: 'toggle', enabled });
      }
    } catch {}
  });

  const handleModeChange = async (mode) => {
    await chrome.storage.local.set({ mode });
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url?.includes('twitter.com') || tab?.url?.includes('x.com')) {
        await safeSendMessage(tab.id, { action: 'modeChange', mode });
      }
    } catch {}
  };

  modeDefault.addEventListener('change', () => handleModeChange('default'));
  modeAgent.addEventListener('change', () => handleModeChange('agent'));

  optionsLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage?.() || window.open(chrome.runtime.getURL('options.html'));
  });

  loadSettings();
});
