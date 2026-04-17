const shared = globalThis.WindowAudioToggleShared;

let loadDebounceTimer = null;
let loadInFlight = false;
let shortcutMap = new Map();

function scheduleLoad() {
  if (loadDebounceTimer !== null) {
    clearTimeout(loadDebounceTimer);
  }
  loadDebounceTimer = setTimeout(() => {
    loadDebounceTimer = null;
    if (!loadInFlight) {
      loadPopupState();
    }
  }, 50);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getShortcutDisplayForWindow(windowIndex) {
  const command = shared.getCommandForWindowIndex(windowIndex);
  if (!command) {
    return 'No shortcut';
  }

  const shortcut = shortcutMap.get(command.name);
  return shortcut || 'Not set';
}

async function refreshShortcutMap() {
  const commands = await chrome.commands.getAll();
  shortcutMap = new Map(commands.map((command) => [command.name, command.shortcut || '']));
}

function renderShortcutStatus() {
  const list = document.getElementById('shortcutList');
  const help = document.getElementById('shortcutHelp');
  const commandDefinitions = shared.getCommandDefinitions();
  const visibleCommands = commandDefinitions.filter((command) => command.windowIndex !== null || command.name === 'unmute-all');
  const hasMissingShortcut = visibleCommands.some((command) => !shortcutMap.get(command.name));

  list.innerHTML = visibleCommands.map((command) => {
    const shortcut = shortcutMap.get(command.name) || 'Not set';
    const cssClass = shortcut === 'Not set' ? 'shortcut-value missing' : 'shortcut-value';
    return `
      <div class="shortcut-row">
        <span class="shortcut-label">${escapeHtml(command.label)}</span>
        <span class="${cssClass}">${escapeHtml(shortcut)}</span>
      </div>
    `;
  }).join('');

  help.textContent = hasMissingShortcut
    ? 'One or more shortcuts are unassigned. Manage them in chrome://extensions/shortcuts.'
    : 'Shortcut assignments are managed in chrome://extensions/shortcuts.';
}

async function sendAction(action, windowId) {
  return chrome.runtime.sendMessage({ type: 'perform-action', action, windowId });
}

function renderWindows(windows) {
  const windowsList = document.getElementById('windowsList');

  if (windows.length === 0) {
    windowsList.innerHTML = '<div class="no-windows">No eligible windows found</div>';
    return;
  }

  windowsList.innerHTML = windows.map((win, index) => {
    const allMuted = shared.areAllTabsMuted(win);
    const shortcutLabel = getShortcutDisplayForWindow(index);
    const title = shared.getWindowTitle(win, index);
    const hostname = shared.getWindowHostname(win);

    return `
      <div class="window-item ${allMuted ? 'muted' : ''}">
        <div class="window-info">
          <div class="window-title">${escapeHtml(title)}</div>
          <div class="window-url">${escapeHtml(hostname)}</div>
          <div class="window-number">${escapeHtml(shortcutLabel)}</div>
        </div>
        <div class="btn-group">
          <button class="btn-mute ${allMuted ? 'muted' : ''}" data-action="toggle-window-mute" data-window-id="${win.id}">
            ${allMuted ? 'Muted' : 'On'}
          </button>
          <button class="btn-solo" data-action="solo-window" data-window-id="${win.id}">Solo</button>
        </div>
      </div>
    `;
  }).join('');
}

async function loadPopupState() {
  if (loadInFlight) {
    return;
  }
  loadInFlight = true;

  try {
    await refreshShortcutMap();
    renderShortcutStatus();

    const windows = await shared.getOrderedWindows();
    renderWindows(windows);
  } catch (error) {
    console.error('Error loading popup state:', error);
    document.getElementById('windowsList').innerHTML = '<div class="no-windows">Error loading windows</div>';
  } finally {
    loadInFlight = false;
  }
}

document.getElementById('windowsList').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) {
    return;
  }

  button.disabled = true;
  try {
    const windowId = Number(button.dataset.windowId);
    await sendAction(button.dataset.action, windowId);
    scheduleLoad();
  } finally {
    button.disabled = false;
  }
});

document.getElementById('muteAll').addEventListener('click', async (event) => {
  event.currentTarget.disabled = true;
  try {
    await sendAction('mute-all');
    scheduleLoad();
  } finally {
    event.currentTarget.disabled = false;
  }
});

document.getElementById('unmuteAll').addEventListener('click', async (event) => {
  event.currentTarget.disabled = true;
  try {
    await sendAction('unmute-all');
    scheduleLoad();
  } finally {
    event.currentTarget.disabled = false;
  }
});

document.addEventListener('DOMContentLoaded', () => {
  loadPopupState();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.lastUpdate) {
    scheduleLoad();
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'audio-state-updated') {
    scheduleLoad();
  }
});
