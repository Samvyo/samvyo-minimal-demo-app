// ─────────────────────────────────────────────────────────────────────────────
// electron/preload.js  —  The Secure IPC Bridge (contextBridge)
//
// WHAT IS THE PRELOAD SCRIPT?
//   The preload script is a special privileged script that runs:
//     • BEFORE the web page (index.html) loads
//     • IN A SEPARATE JavaScript context from the web page
//       (because contextIsolation: true is set in main.js)
//     • WITH access to Electron's ipcRenderer and Node.js APIs
//
// WHY IS IT NEEDED?
//   We want the web page (script.js) to be able to trigger native OS features
//   like screen sharing pickers, notifications, app version, etc.
//   But we CANNOT give the web page direct access to Electron or Node.js —
//   that would be a massive security hole (any XSS attack could own the OS).
//
// HOW IT WORKS:
//   preload.js uses contextBridge.exposeInMainWorld() to create a controlled
//   API on window.samvyoDesktop that the web page CAN see and call.
//   Each function in that API sends a specific IPC message to main.js.
//   main.js handles those messages and returns results.
//
// MENTAL MODEL:
//   web page (script.js)
//       calls → window.samvyoDesktop.pickScreenSource()
//   preload.js
//       translates → ipcRenderer.invoke('media:pickScreenSource')
//   main.js
//       handles → ipcMain.handle('media:pickScreenSource', ...) → returns sources
//   preload.js
//       resolves → Promise resolves in web page with the source list
//
// SECURITY RULES (always follow these):
//   ✅ Expose specific named functions — never expose ipcRenderer itself
//   ✅ Hardcode all channel names in preload — never let the web page pass
//      arbitrary channel strings (that would bypass your whitelist)
//   ✅ Validate all arguments in main.js before using them
//   ✅ Return only plain JS objects/strings — never return Electron objects
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// contextBridge — creates the secure bridge between preload and web page contexts
//   exposeInMainWorld(name, api) adds window[name] = api in the web page context
//   The web page can READ and CALL items in the api, but cannot MODIFY them
//
// ipcRenderer — the renderer side of Electron's Inter-Process Communication
//   .invoke(channel, ...args) → sends a request to main and returns a Promise
//   .send(channel, ...args)   → sends a one-way message to main (no response)
//   .on(channel, listener)    → listens for messages PUSHED from main
const { contextBridge, ipcRenderer } = require('electron');

// ─────────────────────────────────────────────────────────────────────────────
// EXPOSE: window.samvyoDesktop
// ─────────────────────────────────────────────────────────────────────────────
// After this block runs, any code in index.html or script.js can call:
//   window.samvyoDesktop.getAppVersion()
//   window.samvyoDesktop.pickScreenSource()
//   etc.
//
// The web page CANNOT access ipcRenderer directly — only these named functions.

contextBridge.exposeInMainWorld('samvyoDesktop', {

  // ── getAppVersion() ──────────────────────────────────────────────────────
  //
  // WHAT:  Returns the application version string from package.json
  // WHY:   The web page can display "Samvyo Desktop v1.0.22" in the UI,
  //        which helps users know which version they have installed
  // HOW:   invoke() sends 'app:getVersion' to main.js → main returns app.getVersion()
  //
  // Usage in script.js:
  //   if (window.isDesktop) {
  //     const version = await window.samvyoDesktop.getAppVersion();
  //     console.log('Version:', version); // "1.0.22"
  //   }
  //
  // Returns: Promise<string>  e.g. "1.0.22"
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),

  // ── pickScreenSource() ────────────────────────────────────────────────────
  //
  // WHAT:  Returns a list of all screens and open windows available to share
  // WHY:   In a browser, getDisplayMedia() shows Chrome's built-in screen picker.
  //        In Electron, we use desktopCapturer in main.js to get all sources
  //        and return them so the web page can show a CUSTOM picker UI with
  //        thumbnails — a much better experience than the browser default.
  // HOW:   invoke() → main.js calls desktopCapturer.getSources() → returns array
  //
  // Usage in script.js:
  //   const sources = await window.samvyoDesktop.pickScreenSource();
  //   // sources = [{ id, name, thumbnail }, ...]
  //   // Show a picker UI, let user choose, then capture using the chosen id
  //
  // Returns: Promise<Array<{ id: string, name: string, thumbnail: string }>>
  //   id        → used with chromeMediaSourceId in getUserMedia constraints
  //   name      → human-readable label e.g. "Entire Screen", "Chrome"
  //   thumbnail → base64 PNG data URL for showing a preview image
  pickScreenSource: () => ipcRenderer.invoke('media:pickScreenSource'),

  // ── notifyMeetingStarted(meetingId) ──────────────────────────────────────
  //
  // WHAT:  Tells the main process that a meeting has started
  // WHY:   Main process can use this to update the tray icon, show a
  //        "recording" indicator, log analytics, etc.
  // HOW:   send() is fire-and-forget — no Promise, no return value
  //
  // Usage in script.js:
  //   window.samvyoDesktop.notifyMeetingStarted('my-room-123');
  //
  // @param {string} meetingId — the Room ID of the meeting that just started
  // Returns: void
  notifyMeetingStarted: (meetingId) =>
    ipcRenderer.send('meeting:started', meetingId),

  // ── notifyPeerJoined(peerName) ────────────────────────────────────────────
  //
  // WHAT:  Tells the main process that a new peer has joined the call
  // WHY:   If the app is in the background (hidden to tray), the main process
  //        fires a native OS notification so the user knows someone joined
  // HOW:   One-way send() — main.js handles 'peer:joined'
  //
  // Usage in script.js (inside the 'newPeer' event handler):
  //   if (window.isDesktop) {
  //     window.samvyoDesktop.notifyPeerJoined(peerName);
  //   }
  //
  // @param {string} peerName — display name of the peer who joined
  // Returns: void
  notifyPeerJoined: (peerName) =>
    ipcRenderer.send('peer:joined', peerName),

  // ── onTrayNewMeeting(callback) ────────────────────────────────────────────
  //
  // WHAT:  Subscribes to "New Meeting" clicks from the system tray context menu
  // WHY:   When the user clicks "New Meeting" in the tray, main.js sends a
  //        'tray:newMeeting' message. This function lets script.js react to it
  //        (e.g. focus the Room ID input field in the lobby)
  // HOW:   ipcRenderer.on() registers a persistent listener for push events from main
  //
  // Usage in script.js:
  //   window.samvyoDesktop.onTrayNewMeeting(() => {
  //     document.getElementById('roomId').focus();
  //   });
  //
  // @param  {Function} callback — called with no arguments when tray fires
  // Returns: Function — call the returned function to STOP listening (cleanup)
  //   const unsub = window.samvyoDesktop.onTrayNewMeeting(() => { ... });
  //   // Later, when done:
  //   unsub(); // removes the listener, prevents memory leak
  onTrayNewMeeting: (callback) => {
    // Wrap callback in a listener that accepts Electron's injected _event arg
    // We discard _event because the web page doesn't need it
    const listener = (_event) => callback();

    // Register the listener on the 'tray:newMeeting' channel
    ipcRenderer.on('tray:newMeeting', listener);

    // Return an unsubscribe function
    // Callers should invoke this when the listener is no longer needed
    return () => ipcRenderer.removeListener('tray:newMeeting', listener);
  },

  // ── onDeepLink(callback) ─────────────────────────────────────────────────
  //
  // WHAT:  Subscribes to deep link events (samvyo://join/<roomId>)
  // WHY:   When a user clicks a samvyo:// link outside the app (browser, email,
  //        Slack), main.js receives the URL and pushes it to the renderer.
  //        script.js can parse the roomId and auto-fill + auto-join the room.
  // HOW:   Main pushes 'deeplink' channel → this listener fires
  //
  // Usage in script.js:
  //   window.samvyoDesktop.onDeepLink((url) => {
  //     // url = "samvyo://join/my-room-abc"
  //     const roomId = url.replace('samvyo://join/', '');
  //     document.getElementById('roomId').value = roomId;
  //     document.getElementById('initButton').click(); // auto-join
  //   });
  //
  // @param  {Function} callback — called with the full deep link URL string
  // Returns: Function — unsubscribe function
  onDeepLink: (callback) => {
    const listener = (_event, url) => callback(url);
    ipcRenderer.on('deeplink', listener);
    return () => ipcRenderer.removeListener('deeplink', listener);
  },

  // ── onUpdateAvailable(callback) ───────────────────────────────────────────
  //
  // WHAT:  Subscribes to "new version available" push events from main
  // WHY:   When a new version of the desktop app is released, main.js can push
  //        this event so the web page can show an update banner to the user.
  //        (Auto-update is not implemented yet — placeholder for future use)
  // HOW:   Main pushes 'update:available' → this listener fires with version info
  //
  // Usage in script.js:
  //   window.samvyoDesktop.onUpdateAvailable((info) => {
  //     showBanner(`Version ${info.version} is available`);
  //   });
  //
  // @param  {Function} callback — called with { version: string } info object
  // Returns: Function — unsubscribe function
  onUpdateAvailable: (callback) => {
    const listener = (_event, info) => callback(info);
    ipcRenderer.on('update:available', listener);
    return () => ipcRenderer.removeListener('update:available', listener);
  }

}); // end contextBridge.exposeInMainWorld('samvyoDesktop', ...)

// ─────────────────────────────────────────────────────────────────────────────
// EXPOSE: window.isDesktop
// ─────────────────────────────────────────────────────────────────────────────
// A simple boolean flag that script.js uses to detect whether it's running
// inside Electron (desktop app) or in a normal browser (web app).
//
// This flag exists ONLY when the preload script runs — which only happens
// inside Electron. In a normal browser window.isDesktop is undefined → falsy.
//
// Usage in script.js:
//   if (window.isDesktop) {
//     // Use native desktop features (pickScreenSource, etc.)
//   } else {
//     // Use browser fallbacks (getDisplayMedia, etc.)
//   }
contextBridge.exposeInMainWorld('isDesktop', true);
