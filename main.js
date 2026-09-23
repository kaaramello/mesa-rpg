const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');
const os = require('os');

let mainWindow;

function getAllIPs() {
  const ifaces = os.networkInterfaces();
  let wifi = null, radmin = null;
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      if (iface.address.startsWith('26.')) { radmin = iface.address; }
      else if (!wifi) { wifi = iface.address; }
    }
  }
  return { wifi: wifi || 'localhost', radmin };
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
  const { wifi, radmin } = getAllIPs();

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

  const menuItems = [
    { label: `WiFi/Celular: http://${wifi}:${port}`, enabled: false },
  ];
  if (radmin) menuItems.push({ label: `Radmin VPN:  http://${radmin}:${port}`, enabled: false });
  menuItems.push({ type: 'separator' });
  menuItems.push({ label: 'Recarregar', accelerator: 'F5', click: () => mainWindow.reload() });
  menuItems.push({ label: 'Dev Tools', accelerator: 'F12', click: () => mainWindow.webContents.toggleDevTools() });
  menuItems.push({ type: 'separator' });
  menuItems.push({ label: 'Sair', role: 'quit' });

  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'Mesa RPG', submenu: menuItems }]));

  mainWindow.loadURL(`http://localhost:${port}`);

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.setTitle(`Mesa RPG Digital — WiFi: http://${wifi}:${port}${radmin ? ` | Radmin: http://${radmin}:${port}` : ''}`);
    // _wifiURL para celular/rede local, _radminURL para Radmin VPN
    mainWindow.webContents.executeJavaScript(
      `window._wifiURL = "http://${wifi}:${port}"; window._radminURL = ${radmin ? `"http://${radmin}:${port}"` : 'null'};`
    );
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow).catch((err) => {
  const { dialog } = require('electron');
  dialog.showErrorBox('Erro ao iniciar MesaRPG', String(err));
  app.quit();
});
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (!mainWindow) createWindow(); });
