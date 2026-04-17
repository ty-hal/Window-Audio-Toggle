importScripts('shared.js');

const shared = globalThis.WindowAudioToggleShared;

function logEvent(message, details) {
  if (details === undefined) {
    console.info(`[Window Audio Toggle] ${message}`);
    return;
  }
  console.info(`[Window Audio Toggle] ${message}`, details);
}

function logError(message, error, details) {
  console.error(`[Window Audio Toggle] ${message}`, {
    ...(details || {}),
    error: error && error.message ? error.message : String(error),
  });
}

async function notifyPopup(context) {
  await chrome.storage.local.set({ lastUpdate: Date.now() });

  try {
    await chrome.runtime.sendMessage({ type: 'audio-state-updated', context });
  } catch (error) {
    if (!String(error).includes('Receiving end does not exist')) {
      logError('Popup notification failed', error, { context });
    }
  }
}

async function performAction(message) {
  switch (message.action) {
    case 'toggle-window-mute':
      return shared.toggleWindowMuteById(message.windowId);
    case 'solo-window':
      return shared.soloWindowById(message.windowId);
    case 'mute-all':
      return shared.setAllWindowsMuted(true);
    case 'unmute-all':
      return shared.setAllWindowsMuted(false);
    default:
      return { ok: false, reason: 'unknown-action', action: message.action };
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  logEvent('Command received', { command });

  const parsed = shared.parseCommand(command);
  if (!parsed) {
    logEvent('Ignoring unknown command', { command });
    return;
  }

  try {
    let result;
    if (parsed.type === 'unmute-all') {
      result = await shared.setAllWindowsMuted(false);
    } else {
      result = await shared.soloWindowByIndex(parsed.index);
    }

    if (!result.ok) {
      logEvent('Command produced no change', { command, result });
      return;
    }

    logEvent('Command completed', { command, result });
    await notifyPopup({ source: 'command', command, result });
  } catch (error) {
    logError('Command failed', error, { command, parsed });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'perform-action') {
    return false;
  }

  (async () => {
    logEvent('Popup action received', { action: message.action, windowId: message.windowId });

    try {
      const result = await performAction(message);
      if (result.ok) {
        logEvent('Popup action completed', { action: message.action, result });
        await notifyPopup({ source: 'popup', action: message.action, result });
      } else {
        logEvent('Popup action produced no change', { action: message.action, result });
      }
      sendResponse(result);
    } catch (error) {
      logError('Popup action failed', error, { action: message.action, windowId: message.windowId });
      sendResponse({ ok: false, reason: 'action-failed', action: message.action });
    }
  })();

  return true;
});
