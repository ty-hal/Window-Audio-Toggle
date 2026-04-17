const WindowAudioToggleShared = (() => {
  const COMMAND_DEFINITIONS = [
    { name: 'solo-window-1', label: 'Window 1', windowIndex: 0 },
    { name: 'solo-window-2', label: 'Window 2', windowIndex: 1 },
    { name: 'solo-window-3', label: 'Window 3', windowIndex: 2 },
    { name: 'solo-window-4', label: 'Window 4', windowIndex: 3 },
    { name: 'solo-window-5', label: 'Window 5', windowIndex: 4 },
    { name: 'solo-window-6', label: 'Window 6', windowIndex: 5 },
    { name: 'solo-window-7', label: 'Window 7', windowIndex: 6 },
    { name: 'solo-window-8', label: 'Window 8', windowIndex: 7 },
    { name: 'unmute-all', label: 'Unmute All', windowIndex: null },
  ];

  async function getOrderedWindows() {
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
    const byId = new Map();

    for (const win of windows) {
      if (!win || win.id == null || !Array.isArray(win.tabs) || win.tabs.length === 0) {
        continue;
      }
      if (win.state === 'minimized' || byId.has(win.id)) {
        continue;
      }
      byId.set(win.id, win);
    }

    return Array.from(byId.values()).sort((a, b) => {
      const aTop = typeof a.top === 'number' ? a.top : 0;
      const bTop = typeof b.top === 'number' ? b.top : 0;
      if (aTop !== bTop) {
        return aTop - bTop;
      }

      const aLeft = typeof a.left === 'number' ? a.left : 0;
      const bLeft = typeof b.left === 'number' ? b.left : 0;
      if (aLeft !== bLeft) {
        return aLeft - bLeft;
      }

      return a.id - b.id;
    });
  }

  function getCommandDefinitions() {
    return COMMAND_DEFINITIONS.slice();
  }

  function getCommandForWindowIndex(windowIndex) {
    return COMMAND_DEFINITIONS.find((command) => command.windowIndex === windowIndex) || null;
  }

  function parseCommand(commandName) {
    if (commandName === 'unmute-all') {
      return { type: 'unmute-all' };
    }

    const match = /^solo-window-(\d+)$/.exec(commandName);
    if (!match) {
      return null;
    }

    return {
      type: 'solo-window-by-index',
      commandName,
      index: Number(match[1]) - 1,
    };
  }

  function getActiveTab(windowInfo) {
    if (!windowInfo || !Array.isArray(windowInfo.tabs) || windowInfo.tabs.length === 0) {
      return null;
    }
    return windowInfo.tabs.find((tab) => tab.active) || windowInfo.tabs[0] || null;
  }

  function getWindowHostname(windowInfo) {
    const activeTab = getActiveTab(windowInfo);
    if (!activeTab || !activeTab.url) {
      return '';
    }

    try {
      return new URL(activeTab.url).hostname;
    } catch (error) {
      return activeTab.url;
    }
  }

  function getWindowTitle(windowInfo, fallbackIndex) {
    if (windowInfo && windowInfo.title) {
      return windowInfo.title;
    }
    return `Window ${fallbackIndex + 1}`;
  }

  function areAllTabsMuted(windowInfo) {
    if (!windowInfo || !Array.isArray(windowInfo.tabs) || windowInfo.tabs.length === 0) {
      return false;
    }
    return windowInfo.tabs.every((tab) => Boolean(tab.mutedInfo && tab.mutedInfo.muted));
  }

  async function setWindowMuteState(windowInfo, muted) {
    if (!windowInfo || !Array.isArray(windowInfo.tabs)) {
      return;
    }

    for (const tab of windowInfo.tabs) {
      if (!tab || tab.id == null) {
        continue;
      }
      const isMuted = Boolean(tab.mutedInfo && tab.mutedInfo.muted);
      if (isMuted !== muted) {
        await chrome.tabs.update(tab.id, { muted });
      }
    }
  }

  async function toggleWindowMuteById(windowId) {
    const windows = await getOrderedWindows();
    const targetWindow = windows.find((win) => win.id === windowId) || null;
    if (!targetWindow) {
      return { ok: false, reason: 'window-not-found', windowId };
    }

    const nextMutedState = !areAllTabsMuted(targetWindow);
    await setWindowMuteState(targetWindow, nextMutedState);

    return {
      ok: true,
      action: 'toggle-window-mute',
      windowId,
      muted: nextMutedState,
      title: getWindowTitle(targetWindow, windows.indexOf(targetWindow)),
    };
  }

  async function soloWindowById(windowId) {
    const windows = await getOrderedWindows();
    const targetWindow = windows.find((win) => win.id === windowId) || null;
    if (!targetWindow) {
      return { ok: false, reason: 'window-not-found', windowId };
    }

    for (const win of windows) {
      await setWindowMuteState(win, win.id !== targetWindow.id);
    }

    return {
      ok: true,
      action: 'solo-window',
      windowId,
      title: getWindowTitle(targetWindow, windows.indexOf(targetWindow)),
    };
  }

  async function soloWindowByIndex(index) {
    const windows = await getOrderedWindows();
    if (index < 0 || index >= windows.length) {
      return { ok: false, reason: 'window-index-out-of-range', index, windowCount: windows.length };
    }

    return soloWindowById(windows[index].id);
  }

  async function setAllWindowsMuted(muted) {
    const windows = await getOrderedWindows();
    for (const win of windows) {
      await setWindowMuteState(win, muted);
    }

    return {
      ok: true,
      action: muted ? 'mute-all' : 'unmute-all',
      windowCount: windows.length,
    };
  }

  return {
    areAllTabsMuted,
    getCommandDefinitions,
    getCommandForWindowIndex,
    getOrderedWindows,
    getWindowHostname,
    getWindowTitle,
    parseCommand,
    setAllWindowsMuted,
    soloWindowById,
    soloWindowByIndex,
    toggleWindowMuteById,
  };
})();

globalThis.WindowAudioToggleShared = WindowAudioToggleShared;
