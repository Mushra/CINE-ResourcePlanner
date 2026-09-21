// Electron main process. CommonJS on purpose — package.json is "type": "module" for the Vite
// side, but Electron's main process is simplest as plain CJS, loaded via package.json's "main".
const { app, BrowserWindow, protocol, net, dialog, Menu, ipcMain } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const fs = require('node:fs');

const DIST_DIR = path.join(__dirname, '..', 'dist');
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

// sql.js fetches its .wasm file, which `file://` refuses (no fetch scheme support, wrong MIME).
// A custom secure scheme gives the renderer a real origin with fetch/CORS support instead.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function registerAppProtocol() {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let relativePath = decodeURIComponent(url.pathname);
    if (relativePath === '' || relativePath === '/') relativePath = '/index.html';
    const filePath = path.join(DIST_DIR, relativePath);

    if (!filePath.startsWith(DIST_DIR)) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // periodic background check, every 4 hours

function setUpAutoUpdate(win) {
  if (DEV_SERVER_URL) return null; // Never auto-update while running against the Vite dev server.

  // Public repo, public releases — no token needed to check for or download updates.
  const { autoUpdater } = require('electron-updater');
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'Mushra',
    repo: 'CINE-ResourcePlanner',
  });

  // Only the user-initiated "Check for updates…" click should pop up "no update" / error
  // dialogs — the periodic background check stays silent unless it actually finds something.
  let manualCheck = false;
  let checkInFlight = false;

  autoUpdater.on('checking-for-update', () => {
    checkInFlight = true;
  });

  autoUpdater.on('update-available', (info) => {
    checkInFlight = false;
    if (manualCheck) {
      dialog.showMessageBox(win, {
        type: 'info',
        title: 'Update available',
        message: `Version ${info.version} is available and downloading now.`,
      });
    }
  });

  autoUpdater.on('update-not-available', () => {
    checkInFlight = false;
    if (manualCheck) {
      dialog.showMessageBox(win, {
        type: 'info',
        title: 'No updates',
        message: "You're already on the latest version.",
      });
    }
    manualCheck = false;
  });

  autoUpdater.on('download-progress', (progress) => {
    win.setProgressBar(progress.percent / 100);
  });

  autoUpdater.on('update-downloaded', () => {
    checkInFlight = false;
    manualCheck = false;
    win.setProgressBar(-1);
    dialog
      .showMessageBox(win, {
        type: 'info',
        title: 'Update ready',
        message: 'A new version has been downloaded. Restart now to apply it?',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        if (result.response === 0) autoUpdater.quitAndInstall();
      });
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-update error:', err);
    checkInFlight = false;
    win.setProgressBar(-1);
    if (manualCheck) {
      dialog.showMessageBox(win, {
        type: 'error',
        title: 'Update check failed',
        message: `Could not check for updates: ${err.message}`,
      });
    }
    manualCheck = false;
  });

  autoUpdater.checkForUpdates();
  const intervalId = setInterval(() => autoUpdater.checkForUpdates(), CHECK_INTERVAL_MS);
  win.on('closed', () => clearInterval(intervalId));

  return {
    checkNow: () => {
      if (checkInFlight) return;
      manualCheck = true;
      autoUpdater.checkForUpdates();
    },
  };
}

function buildMenu(win, updater) {
  const template = [
    {
      label: 'File',
      submenu: [{ role: 'quit' }],
    },
    {
      label: 'View',
      submenu: [{ role: 'toggleDevTools' }],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for updates…',
          click: () => {
            if (updater) {
              updater.checkNow();
            } else {
              dialog.showMessageBox(win, {
                type: 'info',
                title: 'Updates',
                message: 'Auto-update is not configured for this build.',
              });
            }
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// resources/mpp/{lib,shim,jre} — lib is vendored (committed), shim/jre are build outputs (see
// scripts/prepare-mpp-runtime.mjs). Packaged builds get them via electron-builder's extraResources
// (electron-builder.yml); running against the Vite dev server reads them straight from the repo.
function mppRuntimeDir() {
  return DEV_SERVER_URL ? path.join(__dirname, '..', 'resources', 'mpp') : path.join(process.resourcesPath, 'mpp');
}

function registerMppHandler() {
  ipcMain.handle('mpp:pick-and-parse', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Import MS Project file',
      filters: [{ name: 'MS Project', extensions: ['mpp'] }],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return { canceled: true };
    const mppPath = filePaths[0];

    const runtimeDir = mppRuntimeDir();
    const javaBin = path.join(runtimeDir, 'jre', 'bin', 'java.exe');
    const shimDir = path.join(runtimeDir, 'shim');
    const libGlob = path.join(runtimeDir, 'lib', '*');
    if (!fs.existsSync(javaBin)) {
      return { canceled: false, error: 'The bundled MS Project import runtime is missing from this build.' };
    }

    return new Promise((resolve) => {
      const child = spawn(javaBin, ['-Dlog4j2.StatusLogger.level=OFF', '-cp', `${shimDir}${path.delimiter}${libGlob}`, 'MppToJson', mppPath]);
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', (err) => resolve({ canceled: false, error: `Could not start the import process: ${err.message}` }));
      child.on('close', (code) => {
        if (code !== 0) {
          resolve({ canceled: false, error: stderr.trim() || `Import process exited with code ${code}` });
          return;
        }
        try {
          const json = JSON.parse(stdout);
          resolve({ canceled: false, fileName: path.basename(mppPath), json });
        } catch {
          resolve({ canceled: false, error: 'The import process returned an unexpected response.' });
        }
      });
    });
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  win.once('ready-to-show', () => win.show());

  if (DEV_SERVER_URL) {
    await win.loadURL(DEV_SERVER_URL);
  } else {
    await win.loadURL('app://bundle/index.html');
  }

  const autoUpdaterRef = setUpAutoUpdate(win);
  buildMenu(win, autoUpdaterRef);
}

app.whenReady().then(() => {
  registerAppProtocol();
  registerMppHandler();
  void createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
