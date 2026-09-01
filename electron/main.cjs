// Electron main process. CommonJS on purpose — package.json is "type": "module" for the Vite
// side, but Electron's main process is simplest as plain CJS, loaded via package.json's "main".
const { app, BrowserWindow, protocol, net, dialog, Menu } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

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

function setUpAutoUpdate(win) {
  if (DEV_SERVER_URL) return; // Never auto-update while running against the Vite dev server.

  // Public repo, public releases — no token needed to check for or download updates.
  const { autoUpdater } = require('electron-updater');
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'Mushra',
    repo: 'CINE-ResourcePlanner',
  });

  autoUpdater.on('update-downloaded', () => {
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
  });

  autoUpdater.checkForUpdatesAndNotify();

  return autoUpdater;
}

function buildMenu(win, autoUpdaterRef) {
  const template = [
    {
      label: 'File',
      submenu: [{ role: 'quit' }],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for updates…',
          click: () => {
            if (autoUpdaterRef) {
              autoUpdaterRef.checkForUpdates();
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

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
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
  void createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
