// ─────────────────────────────────────────────────────────────────────────────
// electron/main.js  —  Electron MAIN PROCESS entry point
//
// WHAT IS THE MAIN PROCESS?
//   Every Electron app has one main process. It is a Node.js process that:
//     • Controls the entire app lifecycle (start, quit, reopen)
//     • Creates and manages native OS windows (BrowserWindow)
//     • Has full access to Node.js APIs and the OS
//     • Communicates with the renderer (web page) only via IPC
//
// HOW THIS FILE WORKS (in order):
//   1. Start the Express server (server.js) as a child process
//   2. Wait until the server is listening on its port
//   3. Create the native window (BrowserWindow)
//   4. Load https://localhost:3600 into that window
//   5. Set up IPC handlers so the web page can request native features
//   6. Handle app lifecycle (quit, minimize to tray, macOS dock, etc.)
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// 1. IMPORTS — Electron modules
// ─────────────────────────────────────────────────────────────────────────────

const {
  app,          // Controls the application lifecycle (ready, quit, activate…)
  BrowserWindow,// Creates native OS windows — each is a Chromium renderer process
  ipcMain,      // Receives messages FROM the renderer (web page) via preload bridge
  Tray,         // Creates an icon in the OS system tray / menu bar
  Menu,         // Builds native application menus and tray context menus
  nativeImage,  // Loads image files for tray icons, dock, etc.
  Notification, // Fires native OS notifications (badge, sound, popup)
  shell         // Opens URLs/files in the user's default browser/app
} = require('electron');

// ─────────────────────────────────────────────────────────────────────────────
// 2. IMPORTS — Node.js built-in modules
// ─────────────────────────────────────────────────────────────────────────────

// path → builds file/directory paths that work on all OSes
//   path.join('electron', 'preload.js')  → works on Windows (\) and Unix (/)
const path = require('path');

// child_process.fork → starts server.js in a SEPARATE Node.js child process
//   Why fork() instead of require()?
//     • require() runs server.js in the SAME process as Electron main
//       If the server crashes, it takes down the entire Electron app
//     • fork() runs server.js in its OWN process, isolated from Electron
//       A server crash is catchable and the app stays alive
const { fork } = require('child_process');

// net → low-level TCP networking
//   We use net.createConnection() to check if the Express server port
//   is open and accepting connections before we load the URL
const net = require('net');

// ─────────────────────────────────────────────────────────────────────────────
// 3. IMPORTS — our own modules
// ─────────────────────────────────────────────────────────────────────────────

// buildMenu() creates and sets the native application menu (File, Edit, View…)
// Defined in electron/menu.js — separated for clean code organisation
const { buildMenu } = require('./menu');

// ─────────────────────────────────────────────────────────────────────────────
// 4. CONFIGURATION CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

// isDev → true  = running in development (npm run electron:dev, app not packaged)
//          false = running in production (installed .exe / .dmg / .AppImage)
//
// app.isPackaged is Electron's official API for detecting this.
// Do NOT use process.env.NODE_ENV — it is not reliable in packaged Electron apps.
const isDev = !app.isPackaged;

// SERVER_PORT — must match the PORT value in your .env file (defaults to 3600)
// process.env.PORT is read from the environment (set in .env via dotenv in server.js)
const SERVER_PORT = process.env.PORT || 3600;

// SERVER_URL — the URL Electron's BrowserWindow will load
// Same as typing this in a browser address bar
const SERVER_URL = `https://localhost:${SERVER_PORT}`;

// ─────────────────────────────────────────────────────────────────────────────
// 5. GLOBAL STATE
// ─────────────────────────────────────────────────────────────────────────────

// mainWindow — reference to the one BrowserWindow (native OS window)
// Declared at module level so tray, IPC handlers, and lifecycle events can use it
// Set to null when the window is closed so garbage collection can free its memory
let mainWindow = null;

// serverProcess — reference to the forked Express server child process
// Kept so we can cleanly kill it when the Electron app quits
// Without this, the server child process would become a "zombie" in the OS
let serverProcess = null;

// tray — reference to the system tray icon
// Kept so it is not garbage-collected (Electron will hide the tray if the Tray
// object goes out of scope and gets collected — a common gotcha)
let tray = null;

// isQuitting — tracks whether the user explicitly chose "Quit" from the tray menu
// Used in the window 'close' event to decide: hide to tray vs actually quit
let isQuitting = false;

// ─────────────────────────────────────────────────────────────────────────────
// 6. START THE EXPRESS SERVER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * startServer()
 *
 * Launches server.js as a forked Node.js child process.
 *
 * Why not just require('../server.js')?
 *   require() is synchronous and runs in the same process.
 *   server.js calls httpsServer.listen() which is async and sets up a
 *   persistent server — it would work but mixes the server's state into
 *   Electron's main process, making crashes and restarts harder to handle.
 *   fork() keeps them cleanly separated.
 */
function startServer() {
  // ── Resolve the correct server.js path in both dev and packaged builds ────
  // In development:  __dirname = <project>/electron/
  //                  server.js  = <project>/server.js  → path.join(__dirname, '..', 'server.js')
  //
  // In a packaged .deb/.AppImage, electron-builder puts files inside an .asar
  // archive at: resources/app.asar/
  // Files listed under asarUnpack are ALSO extracted to: resources/app.asar.unpacked/
  //
  // child_process.fork() cannot load a file from inside an .asar archive —
  // it needs a real path on disk. We must point to the unpacked copy.
  //
  // app.getAppPath() returns:
  //   dev:       <project>/
  //   packaged:  <install>/resources/app.asar   ← inside the archive (wrong for fork)
  //
  // The trick: replace 'app.asar' with 'app.asar.unpacked' to get the disk path.
  const appRoot = app.getAppPath().replace('app.asar', 'app.asar.unpacked');
  const serverPath = path.join(appRoot, 'server.js');

  serverProcess = fork(
    serverPath,

    // ── Arguments to pass to server.js ─────────────────────────────────────
    // Empty array — server.js reads configuration from .env, not from argv
    [],

    {
      // cwd must also point to the unpacked root so dotenv finds .env
      // and server.js finds server.key / server.crt via relative paths
      cwd: appRoot,

      // env — the child process inherits all environment variables from Electron
      // We spread process.env so ACCESS_KEY, SECRET_ACCESS_KEY etc. are available
      // NODE_TLS_REJECT_UNAUTHORIZED='0' allows server.js to make HTTPS calls
      // to the Samvyo API even when the API uses a cert we don't have in our trust store
      env: {
        ...process.env,
        NODE_TLS_REJECT_UNAUTHORIZED: '0'
      },

      // silent: false → server.js console.log() output appears in the terminal
      // where you ran 'npm run electron:dev'. Useful for debugging.
      // Set to true in production builds to suppress server logs.
      silent: false
    }
  );

  // ── Server process event listeners ─────────────────────────────────────────

  // 'exit' fires when the child process terminates for any reason
  // code = 0 means clean exit, non-zero means crash/error
  serverProcess.on('exit', (code) => {
    console.log(`[Electron] Express server process exited — code: ${code}`);
  });

  // 'error' fires if fork() itself fails (e.g. server.js file not found)
  serverProcess.on('error', (err) => {
    console.error('[Electron] Failed to start Express server:', err.message);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. WAIT FOR SERVER TO BE READY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * waitForServer(port, retries, delay)
 *
 * Polls the given TCP port until a connection is accepted.
 * Returns a Promise that:
 *   • resolves  → server is ready, safe to call mainWindow.loadURL()
 *   • rejects   → server never started (config error, port clash, etc.)
 *
 * WHY WE NEED THIS:
 *   fork() starts the child process asynchronously. The server.js process needs
 *   ~300–800 ms to:
 *     1. Load dotenv, express, axios
 *     2. Read the SSL certificate files
 *     3. Call httpsServer.listen() and bind to the port
 *   If we call mainWindow.loadURL() before the port is open, Electron shows
 *   "ERR_CONNECTION_REFUSED". This poller prevents that race condition.
 *
 * @param {number} port    - TCP port to check (e.g. 3600)
 * @param {number} retries - Max connection attempts before giving up (default 30)
 * @param {number} delay   - Milliseconds between attempts (default 500 = 0.5 s)
 * @returns {Promise<void>}
 */
function waitForServer(port, retries = 30, delay = 500) {
  return new Promise((resolve, reject) => {
    let attempts = 0; // Counts how many times we have tried

    function tryConnect() {
      attempts++;

      // net.createConnection opens a raw TCP socket to host:port
      // We don't send HTTP data — we just check if the port is open
      // This works for both HTTP and HTTPS servers
      const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
        // ── SUCCESS: connection accepted ─────────────────────────────────────
        // The server is listening and accepting connections
        socket.destroy(); // Close our test connection — we don't need it anymore
        resolve();        // Tell the caller: server is ready
      });

      // Handle connection failure (port not open yet, or OS error)
      socket.on('error', () => {
        socket.destroy(); // Always clean up the socket

        if (attempts >= retries) {
          // We've exhausted all retries — something is genuinely wrong
          // (wrong port, server crashed on startup, .env missing, etc.)
          reject(
            new Error(
              `[Electron] Server did not start on port ${port} after ` +
              `${retries} attempts (${(retries * delay) / 1000}s total)`
            )
          );
        } else {
          // Server not ready yet — wait and try again
          setTimeout(tryConnect, delay);
        }
      });
    }

    // Kick off the first attempt
    tryConnect();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. CREATE THE SYSTEM TRAY ICON
// ─────────────────────────────────────────────────────────────────────────────

/**
 * createTray()
 *
 * Creates a persistent icon in the OS system tray (Windows/Linux taskbar,
 * macOS menu bar). The tray lets the user access Samvyo even when the
 * main window is closed/hidden.
 *
 * VIDEO CONFERENCING IMPORTANCE:
 *   A meeting app must stay alive in the background so it can receive
 *   incoming-meeting notifications, even when the user closes the window.
 *   The tray icon is how the user gets back to the app without relaunching.
 */
function createTray() {
  // ── Load tray icon ─────────────────────────────────────────────────────────
  // nativeImage.createFromPath loads an image from disk
  // We use a 16×16 PNG (Windows/Linux) — macOS auto-scales
  // The fallback creates an empty 1×1 image so Tray() never throws
  const iconPath = path.join(__dirname, '..', 'assets', 'tray.png');
  let trayIcon;

  try {
    // Try to load the custom tray icon
    trayIcon = nativeImage.createFromPath(iconPath);

    // On macOS, tray icons must be monochrome "template" images
    // markAsTemplateImage() tells macOS to adapt the icon to light/dark menu bars
    if (process.platform === 'darwin') {
      trayIcon = trayIcon.resize({ width: 16, height: 16 });
      trayIcon.setTemplateImage(true);
    } else {
      // Windows and Linux: resize to standard 16×16 tray size
      trayIcon = trayIcon.resize({ width: 16, height: 16 });
    }
  } catch {
    // Icon file missing — use empty image so the app still works
    // In production you should always provide the icon file
    trayIcon = nativeImage.createEmpty();
  }

  // Create the Tray instance — this makes the icon appear in the OS tray
  tray = new Tray(trayIcon);

  // Tooltip shown when the user hovers over the tray icon
  tray.setToolTip('Samvyo — Video Conferencing');

  // ── Tray context menu ──────────────────────────────────────────────────────
  // This menu appears when the user right-clicks the tray icon
  const contextMenu = Menu.buildFromTemplate([
    {
      // "Open Samvyo" — shows the main window if hidden, brings it to focus
      label: 'Open Samvyo',
      click: () => {
        if (mainWindow) {
          mainWindow.show();  // Make the window visible
          mainWindow.focus(); // Bring it to the front of all windows
        }
      }
    },
    {
      // "New Meeting" — opens the app and sends an IPC message to the
      // renderer so it can programmatically focus the Room ID input
      label: 'New Meeting',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          // Send a message to the renderer (web page / script.js)
          // script.js listens for 'tray:newMeeting' via the preload bridge
          mainWindow.webContents.send('tray:newMeeting');
        }
      }
    },
    {
      // Separator line — visual divider between items
      type: 'separator'
    },
    {
      // "Quit" — the ONLY way to fully exit the app
      // Setting isQuitting = true tells the window 'close' handler to
      // actually quit instead of just hiding to the tray
      label: 'Quit Samvyo',
      click: () => {
        isQuitting = true; // Allow the window to fully close
        app.quit();        // Trigger the app quit lifecycle
      }
    }
  ]);

  // Attach the context menu to the tray icon
  tray.setContextMenu(contextMenu);

  // On Windows/Linux, single-clicking the tray icon shows the window
  // On macOS, clicking shows the context menu (handled automatically)
  tray.on('click', () => {
    if (mainWindow) {
      // Toggle: if window is visible → hide it; if hidden → show it
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. CREATE THE BROWSER WINDOW
// ─────────────────────────────────────────────────────────────────────────────

/**
 * createWindow()
 *
 * Creates the native OS window (BrowserWindow) and loads the Samvyo app.
 *
 * BrowserWindow is a native window with:
 *   • A Chromium renderer process running inside it (where index.html runs)
 *   • A title bar, resize handles, and OS-native window chrome
 *   • Security settings that control what the web page can and cannot do
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    // ── Window size ──────────────────────────────────────────────────────────
    width: 1280,    // Initial width in pixels — good for HD video layouts
    height: 800,    // Initial height in pixels
    minWidth: 940,  // Minimum width — below this the video grid would break
    minHeight: 600, // Minimum height

    // ── Appearance ───────────────────────────────────────────────────────────
    title: 'Samvyo',  // Text in the OS title bar and taskbar/dock
    show: false,       // CRITICAL: hide window until content loads
                       // Without this, you see a white flash before the app paints
                       // We call mainWindow.show() in the 'ready-to-show' event

    // ── Security: web page preferences ──────────────────────────────────────
    webPreferences: {
      // preload.js runs before index.html in a privileged context
      // It is the ONLY authorised bridge between the web page and Electron
      // path.join() ensures the path separator is correct on all OSes
      preload: path.join(__dirname, 'preload.js'),

      // contextIsolation: true — ALWAYS KEEP TRUE
      //   Runs the preload script and the web page in SEPARATE JS contexts.
      //   The web page has its own 'window' object; the preload has its own.
      //   The only connection is the explicit API exposed via contextBridge.
      //   If false: the web page can access Electron internals → security hole.
      contextIsolation: true,

      // nodeIntegration: false — ALWAYS KEEP FALSE
      //   If true: index.html and script.js could call require(), fs.readFile(),
      //   child_process.exec() etc. — an XSS attack could take over the OS.
      //   If false: the web page is sandboxed like a normal browser tab.
      nodeIntegration: false,

      // sandbox: true — ALWAYS KEEP TRUE
      //   The renderer process runs in an OS-level sandbox.
      //   It cannot access the filesystem or spawn processes directly.
      //   All privileged operations go through preload.js → IPC → main.js.
      sandbox: true,

      // webSecurity: true (default) — keep HTTPS enforcement and CORS in place
      // We handle our self-signed cert separately via 'certificate-error' event
      webSecurity: true
    }
  });

  // ── Handle self-signed SSL certificate ────────────────────────────────────
  // server.js uses server.key + server.crt (a self-signed certificate).
  // Electron rejects self-signed certs by default, just like Chrome does.
  // This event fires when Electron encounters a cert it doesn't trust.
  //
  // We ONLY trust our own localhost:PORT — all other untrusted certs are
  // still rejected. This is the safest minimal approach.
  mainWindow.webContents.on(
    'certificate-error',
    (event, url, error, certificate, callback) => {
      if (url.startsWith(SERVER_URL)) {
        // This is our own local HTTPS server — trust it
        event.preventDefault(); // Stop Electron's default "reject" behaviour
        callback(true);          // Grant trust to this specific certificate
      } else {
        // Any other self-signed cert on the internet → reject (keep user safe)
        callback(false);
      }
    }
  );

  // ── Screen Share: intercept getDisplayMedia() from the renderer ───────────
  //
  // WHY THIS IS NEEDED:
  //   The Samvyo SDK calls navigator.mediaDevices.getDisplayMedia() internally
  //   when vidScaleClient.enableShare() is triggered by the user.
  //
  //   In a regular browser (Chrome/Firefox), getDisplayMedia() shows the OS
  //   built-in screen picker dialog (the one with thumbnails of each window).
  //
  //   In Electron with sandbox:true + contextIsolation:true, that built-in
  //   picker does NOT appear — Electron's Chromium renderer has no access to
  //   the system screen capture API on its own. The call silently fails or
  //   returns an empty/rejected promise, so screen share does nothing.
  //
  // THE FIX — setDisplayMediaRequestHandler (Electron v17+):
  //   This API intercepts every getDisplayMedia() call made by any web page
  //   running inside this BrowserWindow's session. Instead of the browser
  //   picker, OUR code runs: we call desktopCapturer.getSources() from the
  //   privileged main process (which CAN access the OS screen capture),
  //   then pass the chosen source back to the renderer via the callback.
  //
  // RESULT: The SDK's getDisplayMedia() call succeeds transparently — no
  //   changes needed in script.js or the Samvyo SDK. Screen share works.
  mainWindow.webContents.session.setDisplayMediaRequestHandler(
    (_request, callback) => {
      // desktopCapturer lists all screens and application windows
      // available for capture on the current machine
      const { desktopCapturer } = require('electron');

      desktopCapturer
        .getSources({ types: ['screen', 'window'] })
        .then((sources) => {
          // Pick the first screen (the primary monitor — index 0)
          // sources[0] for type:'screen' is always the primary display
          //
          // For a future improvement: show a custom picker dialog so the
          // user can choose which screen/window to share (Phase 3 of the
          // implementation plan uses window.samvyoDesktop.pickScreenSource())
          callback({ video: sources[0] });
        })
        .catch(() => {
          // If getSources() fails (permissions denied, no screens found),
          // call callback with empty object to gracefully reject the request
          // rather than leaving the promise hanging indefinitely
          callback({});
        });
    }
  );

  // ── Load the Samvyo web app into the window ───────────────────────────────
  // loadURL() is equivalent to typing the URL in Chrome's address bar.
  // The Express server (started in startServer()) responds with index.html.
  mainWindow.loadURL(SERVER_URL);

  // ── Open DevTools in development only ────────────────────────────────────
  // DevTools lets you inspect HTML, debug JS, check network requests.
  // 'detach' mode opens DevTools in a SEPARATE window so it doesn't
  // consume space inside the app window.
  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // ── Show window only when fully rendered ─────────────────────────────────
  // 'ready-to-show' fires after the renderer has painted the first frame.
  // Showing before this causes a white flash → bad UX.
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();  // Make the window visible to the user
    mainWindow.focus(); // Bring it to the front of all open windows
  });

  // ── Intercept window close → hide to tray ────────────────────────────────
  // When the user clicks the × button, we hide the window instead of closing.
  // The app continues running in the background (server stays alive,
  // notifications still work). The user re-opens via the tray icon.
  //
  // The ONLY time we actually close is when isQuitting = true (from tray Quit).
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      // Prevent the default close behaviour (which would destroy the window)
      event.preventDefault();
      mainWindow.hide(); // Hide to tray instead
    }
    // If isQuitting is true, we let the close proceed normally
  });

  // ── Clean up reference when window is destroyed ───────────────────────────
  // 'closed' fires after the window has been fully destroyed.
  // Setting mainWindow = null allows the garbage collector to free its memory.
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // ── Build and set the native application menu ────────────────────────────
  // This creates the File / Edit / View / Window / Help menu bar
  // On macOS it appears at the top of the screen; on Win/Linux in the window
  buildMenu(mainWindow);
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. IPC HANDLERS — Main Process Side
// ─────────────────────────────────────────────────────────────────────────────
// ipcMain.handle(channel, handler) registers async request/response handlers.
// The renderer calls window.samvyoDesktop.xxx() → preload calls
// ipcRenderer.invoke(channel) → main process handler runs → returns value.

// ── app:getVersion ─────────────────────────────────────────────────────────
// Returns the version string from package.json (e.g. "1.0.22")
// The renderer can display "Samvyo Desktop v1.0.22" in the UI
ipcMain.handle('app:getVersion', () => {
  return app.getVersion();
});

// ── media:pickScreenSource ──────────────────────────────────────────────────
// Returns a list of all screens and open windows available for screen sharing.
// Each source has: id (used to capture), name (label), thumbnail (preview image).
// The renderer uses this to show a custom picker UI before starting screen share.
//
// We use dynamic require() here because desktopCapturer is only available
// after app is ready, and we register this handler at module load time.
ipcMain.handle('media:pickScreenSource', async () => {
  // desktopCapturer is an Electron API — must be required from the main process
  const { desktopCapturer } = require('electron');

  // getSources() enumerates all capturable sources
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'], // 'screen' = full monitor, 'window' = app windows
    thumbnailSize: { width: 320, height: 180 } // Preview image size in pixels
  });

  // Return only the data the renderer needs — never return raw Electron objects
  // thumbnail.toDataURL() converts the NativeImage to a base64 data URL
  // that can be set as <img src="..."> in the web page
  return sources.map((source) => ({
    id: source.id,                         // e.g. "screen:0:0" or "window:12345:0"
    name: source.name,                     // e.g. "Entire Screen" or "Chrome"
    thumbnail: source.thumbnail.toDataURL() // base64 PNG preview
  }));
});

// ── meeting:started (one-way, fire-and-forget) ──────────────────────────────
// The renderer sends this when a meeting starts — main process logs it.
// Could be extended to update the tray icon, show a notification badge, etc.
ipcMain.on('meeting:started', (_event, meetingId) => {
  // Validate: ensure meetingId is a string before using it
  // Always treat renderer input as untrusted — like an HTTP request body
  if (typeof meetingId !== 'string') return;
  console.log(`[Electron] Meeting started — Room ID: ${meetingId}`);
});

// ── peer:joined (one-way) — fire OS notification ───────────────────────────
// The renderer sends this when a new peer joins the call.
// Main process fires a native OS notification.
ipcMain.on('peer:joined', (_event, peerName) => {
  if (typeof peerName !== 'string') return;

  // Only fire notification if the app window is NOT currently focused
  // (If the user is looking at the call, they already see the peer tile)
  if (mainWindow && !mainWindow.isFocused()) {
    new Notification({
      title: 'Samvyo — New Participant',
      body: `${peerName} joined the meeting`,
      silent: false // play the OS default notification sound
    }).show();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. DEEP LINK HANDLER — samvyo://join/<roomId>
// ─────────────────────────────────────────────────────────────────────────────
// Deep links let users click "samvyo://join/abc123" in a browser, email,
// or Slack message → the desktop app opens and auto-fills the Room ID.

/**
 * routeDeepLink(url)
 *
 * Parses a samvyo:// URL and tells the renderer to navigate.
 * @param {string} url — e.g. "samvyo://join/my-room-id"
 */
function routeDeepLink(url) {
  if (!url || typeof url !== 'string') return;

  console.log(`[Electron] Deep link received: ${url}`);

  // Make sure the window is visible before sending the IPC message
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    // Send the raw URL to the renderer — script.js parses the room ID
    mainWindow.webContents.send('deeplink', url);
  }
}

// Register 'samvyo' as a custom URL protocol on the OS.
// After this, 'samvyo://' links anywhere on the system open this app.
// This must be called before app.whenReady() for some OS configurations.
app.setAsDefaultProtocolClient('samvyo');

// macOS: deep links come in via the 'open-url' event on the app object
app.on('open-url', (event, url) => {
  event.preventDefault(); // Stop Electron's default URL handling
  routeDeepLink(url);
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. SINGLE INSTANCE LOCK (Windows & Linux deep link support)
// ─────────────────────────────────────────────────────────────────────────────
// On Windows/Linux, clicking a samvyo:// link launches a NEW instance of the app.
// We use a "single instance lock" to prevent multiple copies running at once.
// The second instance passes its arguments to the FIRST instance and then quits.

// requestSingleInstanceLock() returns:
//   true  → this IS the first instance — continue normally
//   false → another instance is already running — quit immediately
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  // Another Samvyo instance is already open — quit this new one immediately
  app.quit();
} else {
  // We are the first (and only) instance.
  // 'second-instance' fires when the user tries to open a SECOND instance
  // (e.g. clicks a samvyo:// link while the app is already open)
  app.on('second-instance', (_event, commandLine) => {
    // commandLine is the argv array of the second instance
    // On Windows/Linux, the deep link URL is passed as a command-line argument
    const url = commandLine.find((arg) => arg.startsWith('samvyo://'));
    if (url) routeDeepLink(url);

    // Show and focus the existing window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore(); // Un-minimise if minimised
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 13. APP LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// App-level certificate error handler
// This covers ALL network requests in the app (not just the BrowserWindow).
// It runs before the webContents-level handler in createWindow().
// Both are needed to fully suppress the self-signed cert warnings.
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (url.startsWith(SERVER_URL)) {
    event.preventDefault(); // Override the default rejection
    callback(true);          // Trust our local self-signed certificate
  } else {
    callback(false);         // Reject all other untrusted certs
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// app.whenReady() → resolves when Electron has fully initialised.
// We MUST wait for this before creating any BrowserWindow.
// It is equivalent to DOMContentLoaded for the Electron main process.
app.whenReady().then(async () => {

  // ── Step A: Set App User Model ID (Windows only) ─────────────────────────
  // This links the app to its taskbar button and is required for Windows
  // notifications to show the correct app name and icon.
  // Must be called before any window is created.
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.samvyo.desktop');
  }

  // ── Step B: Start the Express server ─────────────────────────────────────
  startServer();

  // ── Step C: Wait until the server is ready ───────────────────────────────
  try {
    await waitForServer(SERVER_PORT);
    console.log(`[Electron] Express server is ready on port ${SERVER_PORT}`);
  } catch (err) {
    // Server failed to start — cannot continue without it
    console.error('[Electron] FATAL:', err.message);
    app.quit(); // Quit Electron — no point showing an empty window
    return;     // Stop executing this async function
  }

  // ── Step D: Create the system tray icon ──────────────────────────────────
  createTray();

  // ── Step E: Create the main window and load the app ──────────────────────
  createWindow();

  // ── macOS: re-create the window when the dock icon is clicked ────────────
  // Standard macOS behaviour: clicking the dock icon when no window is open
  // should re-open the window (Safari, Finder, etc. all behave this way)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// ── Quit when all windows are closed ─────────────────────────────────────────
// On Windows/Linux: when the last window is closed, quit the app.
// On macOS: apps normally stay running even with no windows (controlled by dock).
//   The 'darwin' check implements this standard macOS convention.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ── Before quit: clean up the Express server child process ───────────────────
// 'before-quit' fires just before the app exits (triggered by app.quit()).
// We must kill the forked server process here, otherwise:
//   • On Windows/Linux: the child process becomes a zombie — still running in
//     the background, holding the port open, even after Electron is closed.
//   • The next launch would fail with "port already in use".
app.on('before-quit', () => {
  isQuitting = true; // Ensure the window 'close' handler doesn't block quit

  if (serverProcess) {
    serverProcess.kill('SIGTERM'); // Politely ask the child process to shut down
    serverProcess = null;          // Clear the reference
  }
});
