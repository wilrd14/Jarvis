// Proceso principal de Jarvis (Electron). CommonJS para no necesitar paso de build.
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  globalShortcut,
  nativeImage,
  session,
  shell,
} = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

app.setName("Jarvis");

// En Windows el ejecutable no tiene consola: reflejamos los logs en un archivo de userData.
let logStream = null;
function log(...args) {
  const line = args.join(" ");
  try {
    if (!logStream) {
      logStream = fs.createWriteStream(path.join(app.getPath("userData"), "jarvis.log"), { flags: "a" });
    }
    logStream.write(new Date().toISOString() + " " + line + "\n");
  } catch {
    /* sin log */
  }
}

const BG = "#05080a";
const SHORTCUT = "Control+Alt+J";
// En desarrollo, electron:dev define JARVIS_DEV_URL y no arrancamos servidor propio.
const DEV_URL = process.env.JARVIS_DEV_URL || "";
const ICON_PATH = path.join(__dirname, "icon.png");

let mainWindow = null;
let tray = null;
let serverProcess = null;
let appOrigin = "";
let quitting = false;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function readStoredApiKey(dataDir) {
  try {
    const raw = fs.readFileSync(path.join(dataDir, "settings.json"), "utf8");
    const key = JSON.parse(raw).openrouterApiKey;
    return typeof key === "string" && key.trim() ? key.trim() : "";
  } catch {
    return "";
  }
}

function serverDir() {
  // Empaquetado: extraResources -> <resources>/server. Sin empaquetar: .next/standalone.
  return app.isPackaged
    ? path.join(process.resourcesPath, "server")
    : path.join(__dirname, "..", ".next", "standalone");
}

function startServer(port, dataDir) {
  const dir = serverDir();
  const serverJs = path.join(dir, "server.js");
  if (!fs.existsSync(serverJs)) {
    throw new Error(`No se encuentra el servidor de Next en ${serverJs}. Ejecuta "npm run build".`);
  }
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    JARVIS_DATA_DIR: dataDir,
  };
  const storedKey = readStoredApiKey(dataDir);
  if (storedKey) env.OPENROUTER_API_KEY = storedKey;

  serverProcess = spawn(process.execPath, [serverJs], {
    cwd: dir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  serverProcess.stdout.on("data", (d) => log(`[next] ${d}`.trimEnd()));
  serverProcess.stderr.on("data", (d) => log(`[next:err] ${d}`.trimEnd()));
  serverProcess.on("exit", (code) => {
    serverProcess = null;
    if (!quitting) {
      log(`[jarvis] El servidor de Next terminó (código ${code}).`);
      quitting = true;
      app.quit();
    }
  });
}

function stopServer() {
  if (serverProcess) {
    try {
      serverProcess.kill();
    } catch {
      /* ya terminado */
    }
    serverProcess = null;
  }
}

function waitForServer(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("El servidor no respondió a tiempo."));
        else setTimeout(attempt, 250);
      });
      req.setTimeout(2000, () => req.destroy());
    };
    attempt();
  });
}

function isAppUrl(url) {
  try {
    return new URL(url).origin === appOrigin;
  } catch {
    return false;
  }
}

function openExternalSafe(url) {
  try {
    const { protocol } = new URL(url);
    if (["http:", "https:", "mailto:", "tel:"].includes(protocol)) shell.openExternal(url);
  } catch {
    /* URL inválida: se ignora */
  }
}

function setupSecurity() {
  const ses = session.defaultSession;
  const allowed = new Set(["media", "clipboard-sanitized-write"]);
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const url = (details && details.requestingUrl) || (wc && wc.getURL()) || "";
    callback(allowed.has(permission) && isAppUrl(url));
  });
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
    return allowed.has(permission) && isAppUrl(requestingOrigin);
  });
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleWindow() {
  if (mainWindow && mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide();
  else showWindow();
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 420,
    minHeight: 480,
    backgroundColor: BG,
    title: "Jarvis",
    icon: ICON_PATH,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  mainWindow.removeMenu();
  mainWindow.once("ready-to-show", () => mainWindow && mainWindow.show());

  const wc = mainWindow.webContents;
  wc.on("will-navigate", (event, target) => {
    if (!isAppUrl(target)) {
      event.preventDefault();
      openExternalSafe(target);
    }
  });
  wc.setWindowOpenHandler(({ url: target }) => {
    if (isAppUrl(target)) return { action: "deny" };
    openExternalSafe(target);
    return { action: "deny" };
  });

  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.loadURL(url);
}

function createTray() {
  const img = nativeImage.createFromPath(ICON_PATH).resize({ width: 32, height: 32 });
  tray = new Tray(img);
  tray.setToolTip("Jarvis");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Mostrar", click: showWindow },
      {
        label: "Salir",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", toggleWindow);
}

async function boot() {
  const dataDir = app.getPath("userData");
  let url;
  if (DEV_URL) {
    url = DEV_URL;
  } else {
    const port = Number(process.env.JARVIS_PORT) || (await getFreePort());
    startServer(port, dataDir);
    url = `http://127.0.0.1:${port}`;
    await waitForServer(url);
  }
  appOrigin = new URL(url).origin;
  log(`[jarvis] URL de la app: ${url} (datos en ${dataDir})`);

  Menu.setApplicationMenu(null);
  setupSecurity();
  createWindow(url);
  createTray();
  if (!globalShortcut.register(SHORTCUT, toggleWindow)) {
    log(`[jarvis] No se pudo registrar el atajo ${SHORTCUT}.`);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.whenReady().then(boot).catch((err) => {
    log("[jarvis] Error al arrancar:", err);
    quitting = true;
    stopServer();
    app.quit();
  });
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    stopServer();
  });
  // La app vive en la bandeja: no salir al cerrar la ventana.
  app.on("window-all-closed", () => {});
}
