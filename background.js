// Background service worker for keyboard shortcuts

async function getOrderedWindows() {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });

  // Filter out windows without tabs and dedupe by window ID
  const byId = new Map();
  for (const win of windows) {
    if (win && win.id != null && win.tabs && win.tabs.length > 0 && !byId.has(win.id) && win.state !== 'minimized') {
      byId.set(win.id, win);
    }
  }
  const validWindows = Array.from(byId.values());

  // Sort top-to-bottom (monitor rows), then left-to-right within each row (then by ID)
  validWindows.sort((a, b) => {
    const ay = typeof a.top === 'number' ? a.top : 0;
    const by = typeof b.top === 'number' ? b.top : 0;
    if (ay !== by) return ay - by;

    const ax = typeof a.left === 'number' ? a.left : 0;
    const bx = typeof b.left === 'number' ? b.left : 0;
    if (ax !== bx) return ax - bx;
    return a.id - b.id;
  });

  return validWindows;
}

async function toggleWindowByIndex(index) {
  const windows = await getOrderedWindows();
  if (index < 0 || index >= windows.length) return;

  const win = windows[index];
  const allMuted = win.tabs && win.tabs.length > 0
    ? win.tabs.every(tab => tab.mutedInfo && tab.mutedInfo.muted)
    : false;
  const newMutedState = !allMuted;

  for (const tab of win.tabs || []) {
    const muted = tab.mutedInfo && tab.mutedInfo.muted;
    if (muted !== newMutedState) {
      await chrome.tabs.update(tab.id, { muted: newMutedState });
    }
  }

  showNotification(win && win.title, newMutedState ? 'Muted' : 'Unmuted');
  notifyPopup();
}

async function soloWindowByIndex(index) {
  const windows = await getOrderedWindows();
  if (index < 0 || index >= windows.length) return;

  const targetWindow = windows[index];

  for (let i = 0; i < windows.length; i++) {
    const win = windows[i];
    const shouldMute = win.id !== targetWindow.id;

    for (const tab of win.tabs || []) {
      const muted = tab.mutedInfo && tab.mutedInfo.muted;
      if (muted !== shouldMute) {
        await chrome.tabs.update(tab.id, { muted: shouldMute });
      }
    }
  }

  showNotification(targetWindow && targetWindow.title, 'Solo (others muted)');
  notifyPopup();
}

// Notifications caused repeated image download errors and are not critical
// for this extension's core behavior. Make this a no-op to avoid all errors.
function showNotification() {
  // intentionally empty
}

function notifyPopup() {
  chrome.storage.local.set({ lastUpdate: Date.now() });

  if (!chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
    return;
  }

  try {
    chrome.runtime.sendMessage({ type: 'audio-state-updated' }, () => {
      // If there is no receiver (popup closed), Chrome sets lastError – ignore it
      if (chrome.runtime.lastError) {
        // No active popup to receive the message; this is fine
      }
    });
  } catch (e) {
    // Ignore unexpected errors from sendMessage
  }
}

async function unmuteAll() {
  const windows = await getOrderedWindows();
  
  for (const win of windows) {
    for (const tab of win.tabs || []) {
      const muted = tab.mutedInfo && tab.mutedInfo.muted;
      if (muted) {
        await chrome.tabs.update(tab.id, { muted: false });
      }
    }
  }
  
  showNotification('All windows', 'Unmuted');
  notifyPopup();
}

// Command listeners
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'unmute-all') {
    await unmuteAll();
  } else {
    const index = parseInt(command.split('-').pop()) - 1;
    if (command.startsWith('solo-window-')) {
      await soloWindowByIndex(index);
    }
  }
});

// Listen for extension icon click
chrome.action.onClicked.addListener(async () => {
  const popup = await chrome.action.getPopup();
  // Popup will handle it
});
