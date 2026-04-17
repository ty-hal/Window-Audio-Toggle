let lastKnownUpdate = 0;
let loadDebounceTimer = null;
let loadInFlight = false;

// Single entry point for all refresh triggers – debounces rapid concurrent calls
// so only one loadWindows() actually runs at a time.
function scheduleLoad() {
  if (loadDebounceTimer !== null) {
    clearTimeout(loadDebounceTimer);
  }
  loadDebounceTimer = setTimeout(() => {
    loadDebounceTimer = null;
    if (!loadInFlight) {
      loadWindows();
    }
  }, 50);
}

async function checkForUpdates() {
  const result = await chrome.storage.local.get('lastUpdate');
  const newUpdate = result.lastUpdate || 0;
  if (newUpdate > lastKnownUpdate) {
    lastKnownUpdate = newUpdate;
    scheduleLoad();
  }
}

async function loadWindows() {
  if (loadInFlight) return;
  loadInFlight = true;

  const windowsList = document.getElementById('windowsList');
  windowsList.innerHTML = '';

  try {
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
    
    // Dedupe by window ID and filter to only windows with audio (tabs with sound)
    const byId = new Map();
    for (const win of windows) {
      if (!win || win.id == null || !win.tabs || win.tabs.length === 0) continue;
      if (win.state === 'minimized') continue;
      if (byId.has(win.id)) continue;

      const hasAudio = win.tabs.some(tab => tab.audible || !tab.mutedInfo.muted);
      if (hasAudio || win.tabs.length > 0) {
        byId.set(win.id, win);
      }
    }

    const audioWindows = Array.from(byId.values());

    // Sort to match background ordering: top-to-bottom (rows), then left-to-right, then by ID
    audioWindows.sort((a, b) => {
      const ay = typeof a.top === 'number' ? a.top : 0;
      const by = typeof b.top === 'number' ? b.top : 0;
      if (ay !== by) return ay - by;

      const ax = typeof a.left === 'number' ? a.left : 0;
      const bx = typeof b.left === 'number' ? b.left : 0;
      if (ax !== bx) return ax - bx;
      return a.id - b.id;
    });

    if (audioWindows.length === 0) {
      windowsList.innerHTML = '<div class="no-windows">No windows found</div>';
      return;
    }

    for (let i = 0; i < audioWindows.length; i++) {
      const win = audioWindows[i];
      const windowNumber = i + 1;
      
      // Get mute state (true if ALL tabs are muted)
      const allMuted = win.tabs.every(tab => tab.mutedInfo.muted);
      const anyMuted = win.tabs.some(tab => tab.mutedInfo.muted);
      
      const windowTitle = win.title || `Window ${windowNumber}`;
      const activeTab = win.tabs.find(t => t.active) || win.tabs[0];
      let url = '';
      if (activeTab && activeTab.url) {
        try {
          url = new URL(activeTab.url).hostname;
        } catch (e) {
          url = activeTab.url;
        }
      }
      
      const windowItem = document.createElement('div');
      windowItem.className = `window-item ${allMuted ? 'muted' : ''}`;
      windowItem.innerHTML = `
        <div class="window-info">
          <div class="window-title">${escapeHtml(windowTitle)}</div>
          <div class="window-url">${escapeHtml(url)}</div>
          <div class="window-number">Opt+${windowNumber}</div>
        </div>
        <div class="btn-group">
          <button class="btn-mute ${allMuted ? 'muted' : ''}" data-window="${win.id}">
            ${allMuted ? 'Muted' : 'On'}
          </button>
          <button class="btn-solo" data-window="${win.id}">Solo</button>
        </div>
      `;
      
      windowsList.appendChild(windowItem);
    }

    // Add event listeners
    document.querySelectorAll('.btn-mute').forEach(btn => {
      btn.addEventListener('click', async () => {
        const windowId = parseInt(btn.dataset.window);
        await toggleWindowMute(windowId);
        loadWindows();
      });
    });

    document.querySelectorAll('.btn-solo').forEach(btn => {
      btn.addEventListener('click', async () => {
        const windowId = parseInt(btn.dataset.window);
        await soloWindow(windowId, audioWindows);
        loadWindows();
      });
    });

  } catch (error) {
    console.error('Error loading windows:', error);
    windowsList.innerHTML = '<div class="no-windows">Error loading windows</div>';
  } finally {
    loadInFlight = false;
  }
}

async function toggleWindowMute(windowId) {
  try {
    const win = await chrome.windows.get(windowId, { populate: true });
    const allMuted = win.tabs.every(tab => tab.mutedInfo.muted);
    const newMutedState = !allMuted;
    
    for (const tab of win.tabs) {
      if (tab.mutedInfo.muted !== newMutedState) {
        await chrome.tabs.update(tab.id, { muted: newMutedState });
      }
    }
  } catch (error) {
    console.error('Error toggling mute:', error);
  }
}

async function soloWindow(targetWindowId, allWindows) {
  try {
    for (const win of allWindows) {
      const shouldMute = win.id !== targetWindowId;
      
      for (const tab of win.tabs) {
        if (tab.mutedInfo.muted !== shouldMute) {
          await chrome.tabs.update(tab.id, { muted: shouldMute });
        }
      }
    }
  } catch (error) {
    console.error('Error soloing window:', error);
  }
}

async function muteAll() {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    for (const win of windows) {
      if (win.tabs) {
        for (const tab of win.tabs) {
          if (!tab.mutedInfo.muted) {
            await chrome.tabs.update(tab.id, { muted: true });
          }
        }
      }
    }
    loadWindows();
  } catch (error) {
    console.error('Error muting all:', error);
  }
}

async function unmuteAll() {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    for (const win of windows) {
      if (win.tabs) {
        for (const tab of win.tabs) {
          if (tab.mutedInfo.muted) {
            await chrome.tabs.update(tab.id, { muted: false });
          }
        }
      }
    }
    loadWindows();
  } catch (error) {
    console.error('Error unmuting all:', error);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Event listeners for header buttons
document.getElementById('muteAll').addEventListener('click', muteAll);
document.getElementById('unmuteAll').addEventListener('click', unmuteAll);

// Load windows when popup opens
document.addEventListener('DOMContentLoaded', async () => {
  const result = await chrome.storage.local.get('lastUpdate');
  lastKnownUpdate = result.lastUpdate || 0;
  loadWindows();
  
  // Poll for updates every 300ms to ensure sync
  setInterval(checkForUpdates, 300);
});

// Listen for storage changes (from keyboard shortcuts)
chrome.storage.onChanged.addListener((changes) => {
  if (changes.lastUpdate) {
    lastKnownUpdate = changes.lastUpdate.newValue;
    scheduleLoad();
  }
});

// Also listen for direct messages from the background (keyboard shortcuts)
chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'audio-state-updated') {
    scheduleLoad();
  }
});
