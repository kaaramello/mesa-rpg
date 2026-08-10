const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');
const os = require('os');

let mainWindow;

function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

async function startServer() {
  const { createServer, connectMongo, loadRooms } = require('./app');
  const port = process.env.PORT || 5000;
  await connectMongo();
  await loadRooms();
  await createServer(port);
  return port;
}

async function createWindow() {
  const port = await startServer();
  const localIP = getLocalIP();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#111118',
    title: 'Mesa RPG Digital',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Menu minimalista
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Mesa RPG',
      submenu: [
        { label: `Link local: http://${localIP}:${port}`, enabled: false },
        { type: 'separator' },
        { label: 'Recarregar', accelerator: 'F5', click: () => mainWindow.reload() },
        { label: 'Dev Tools', accelerator: 'F12', click: () => mainWindow.webContents.toggleDevTools() },
        { type: 'separator' },
        { label: 'Sair', role: 'quit' },
      ]
    }
  ]));

  mainWindow.loadURL(`http://localhost:${port}`);

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.setTitle(`Mesa RPG Digital — compartilhe: http://${localIP}:${port}`);
    mainWindow.webContents.executeJavaScript(`window._radminURL = "http://${localIP}:${port}";`);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (!mainWindow) createWindow(); });
