// ─────────────────────────────────────────────────────────────────────────────
// electron/menu.js  —  Native Application Menu
//
// WHAT IS THE APPLICATION MENU?
//   The native menu bar at the top of the screen (macOS) or window (Windows/Linux).
//   It contains: File | Edit | View | Window | Help
//   Each item is a native OS menu — keyboard shortcuts are registered at the OS level.
//
// WHY DO WE NEED A CUSTOM MENU?
//   By default, Electron provides no menu (or a generic one in dev mode).
//   Problems with no menu:
//     • On macOS: Cmd+C / Cmd+V / Cmd+X (copy/paste/cut) DO NOT WORK in text inputs
//       without an Edit menu — this would break the Room ID and Peer Name fields.
//     • Users have no way to reload, zoom, go fullscreen, or access DevTools.
//     • No "About Samvyo", no "Quit" menu item on macOS.
//
// PLATFORM DIFFERENCES:
//   macOS   → first menu item is ALWAYS the "App Menu" (named after the app)
//             This contains: About, Services, Hide, Quit — OS convention.
//   Windows → no "App Menu" concept. Menu bar lives INSIDE the window.
//   Linux   → same as Windows, menu bar in window.
//
// HOW TO USE:
//   import { buildMenu } from './menu';
//   buildMenu(mainWindow); // called once after createWindow()
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// Menu  → builds and sets the application menu from a template array
// shell → opens URLs in the user's default browser (used for Help links)
const { Menu, shell } = require('electron');

/**
 * buildMenu(mainWindow)
 *
 * Builds and registers the native application menu.
 * Called once from main.js after the BrowserWindow is created.
 *
 * @param {Electron.BrowserWindow} mainWindow
 *   Reference to the main window — needed so Help menu items can send
 *   IPC messages or reload the window.
 */
function buildMenu(mainWindow) {

  // Detect operating system once — used throughout the template
  // process.platform values: 'darwin' (macOS), 'win32' (Windows), 'linux'
  const isMac = process.platform === 'darwin';

  // ── Menu Template ──────────────────────────────────────────────────────────
  // Electron's menu is built from a flat array of top-level menu objects.
  // Each object can be:
  //   { role: 'editMenu' }          → Electron fills it with standard items
  //   { label: 'X', submenu: [...] }→ custom menu with your own items
  //
  // 'role' is Electron's shortcut for standard OS behaviour — it adds the
  // correct label, shortcut, and action for the current platform automatically.
  // Always prefer role over custom implementations for standard actions.

  const menuTemplate = [

    // ── [0] macOS App Menu ───────────────────────────────────────────────────
    // On macOS, the FIRST menu is ALWAYS the "application menu" —
    // it's labelled with the app name (Samvyo) and contains OS-standard items.
    // On Windows/Linux this menu does not exist, so we conditionally include it.
    //
    // The spread operator ...[] inserts the items only on macOS:
    //   isMac ? [{ ... }] : []  → on macOS: one item; on Win/Linux: empty array
    ...(isMac ? [{
      // label is omitted — macOS automatically uses the app name
      role: 'appMenu'
      // 'appMenu' role includes: About Samvyo, Services, Hide, Hide Others,
      // Show All, and Quit — all built-in macOS conventions
    }] : []),

    // ── [1] File Menu ────────────────────────────────────────────────────────
    {
      // 'fileMenu' role includes:
      //   macOS: Close Window
      //   Windows/Linux: Quit
      role: 'fileMenu'
    },

    // ── [2] Edit Menu ────────────────────────────────────────────────────────
    // CRITICAL — do not remove this menu.
    //
    // On macOS, Cmd+C / Cmd+V / Cmd+X (copy/paste/cut) are registered at
    // the MENU level, not by the browser. Without 'editMenu':
    //   • Users cannot paste into the Room ID input
    //   • Users cannot paste into the Peer Name input
    //   • Copy/paste in the captions panel won't work
    // This is one of the most common Electron bugs — always include editMenu.
    //
    // 'editMenu' role includes:
    //   Undo, Redo, Cut, Copy, Paste, Paste and Match Style (macOS),
    //   Delete, Select All, Speech (macOS)
    {
      role: 'editMenu'
    },

    // ── [3] View Menu ────────────────────────────────────────────────────────
    // Gives users control over the window's view/zoom level.
    // 'viewMenu' role includes:
    //   Reload, Force Reload, Toggle Developer Tools,
    //   Actual Size, Zoom In, Zoom Out, Toggle Fullscreen
    {
      role: 'viewMenu'
    },

    // ── [4] Window Menu ──────────────────────────────────────────────────────
    // OS-standard window management.
    // 'windowMenu' role includes:
    //   macOS: Minimize, Zoom, Bring All to Front
    //   Windows/Linux: Minimize, Close
    {
      role: 'windowMenu'
    },

    // ── [5] Help Menu ────────────────────────────────────────────────────────
    // Custom help items — links, report bug, version info.
    {
      role: 'help',         // 'help' role handles macOS Help menu positioning
      submenu: [

        // "Documentation" → opens Samvyo docs in the default browser
        // shell.openExternal() opens URLs in the OS default browser (Chrome/Firefox/Safari)
        // It does NOT open a new Electron window — important for external links
        {
          label: 'Samvyo Documentation',
          click: () => shell.openExternal('https://samvyo.com/docs')
        },

        // "Report an Issue" → sends an IPC message to the renderer
        // The renderer (script.js) can listen via window.isDesktop and
        // show an in-app feedback form, or open a support URL
        {
          label: 'Report an Issue',
          click: () => {
            // webContents.send() pushes a message FROM main TO the renderer
            // The renderer listens via ipcRenderer.on('menu:reportIssue') in preload
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('menu:reportIssue');
            }
          }
        },

        // Separator between links and app info
        { type: 'separator' },

        // "About Samvyo" (Windows/Linux only)
        // On macOS this is already in the App Menu (role: 'appMenu')
        // On Windows/Linux there is no automatic About item, so we add one
        ...(!isMac ? [{
          label: 'About Samvyo',
          click: () => {
            // showAboutPanel() shows Electron's built-in About dialog
            // It reads app name, version, and author from package.json automatically
            const { app, dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Samvyo',
              message: 'Samvyo Desktop',
              detail: `Version: ${app.getVersion()}\nA real-time video conferencing application.`,
              buttons: ['OK']
            });
          }
        }] : [])

      ]
    }

  ]; // end menuTemplate

  // ── Build and set the menu ──────────────────────────────────────────────────
  // Menu.buildFromTemplate() converts the template array into a native Menu object
  // Menu.setApplicationMenu() registers it as THE application menu for all windows
  //   On macOS: appears at the top of the screen
  //   On Windows/Linux: appears inside the window frame at the top
  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}

// Export buildMenu so main.js can import and call it
module.exports = { buildMenu };
