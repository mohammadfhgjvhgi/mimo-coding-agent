// MiMo X — Electron Main Process
// Opens a desktop window (1280x800) that loads the Next.js app.
// On launch: shows a splash screen, auto-starts the infrastructure
// (llama.cpp dual-worker servers), then loads the main UI.

const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const { spawn, exec } = require("child_process");
const http = require("http");

const NEXT_URL = process.env.MIMO_NEXT_URL || "http://localhost:3000";
const IS_DEV = process.env.NODE_ENV !== "production";
const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 800;

let splashWindow = null;
let mainWindow = null;
let infraProcess = null;

// ---- Splash Screen -------------------------------------------------------
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 320,
    frame: false,
    transparent: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  splashWindow.loadFile(path.join(__dirname, "splash.html"));
  splashWindow.on("closed", () => { splashWindow = null; });
}

// ---- Main Window ---------------------------------------------------------
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "MiMo X",
    backgroundColor: "#0a0a0a",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.loadURL(NEXT_URL);

  mainWindow.once("ready-to-show", () => {
    if (splashWindow) splashWindow.close();
    mainWindow.show();
    mainWindow.focus();
  });

  // Open external links in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}

// ---- Auto-Start Infrastructure ------------------------------------------
function startInfrastructure() {
  const platform = process.platform;
  let scriptPath;
  let args = [];

  if (platform === "win32") {
    // Windows: run the .bat version
    scriptPath = path.join(__dirname, "..", "infrastructure", "start-mimo-servers.bat");
    args = [];
  } else {
    // Linux/macOS: run the .sh version
    scriptPath = path.join(__dirname, "..", "infrastructure", "start-mimo-servers.sh");
    args = [];
  }

  try {
    const cmd = platform === "win32" ? "cmd.exe" : "bash";
    const cmdArgs = platform === "win32" ? ["/c", scriptPath] : [scriptPath];

    infraProcess = spawn(cmd, cmdArgs, {
      cwd: path.join(__dirname, ".."),
      detached: true,
      stdio: "ignore",
    });

    infraProcess.on("error", (err) => {
      console.error("[MiMo X] Infrastructure start failed:", err.message);
      // Continue anyway — the app can still work with Z.ai fallback
    });

    console.log("[MiMo X] Infrastructure starting (PID:", infraProcess.pid, ")");
  } catch (e) {
    console.error("[MiMo X] Could not start infrastructure:", e.message);
  }
}

// ---- Wait for Next.js server to be ready ---------------------------------
function waitForServer(url, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const start = Date.now();
    function check() {
      const req = http.get(url, (res) => {
        if (res.statusCode === 200 || res.statusCode === 307) {
          resolve(true);
        } else if (Date.now() - start > timeoutMs) {
          resolve(false);
        } else {
          setTimeout(check, 1000);
        }
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          resolve(false);
        } else {
          setTimeout(check, 1000);
        }
      });
      req.setTimeout(3000, () => {
        req.destroy();
        if (Date.now() - start > timeoutMs) resolve(false);
        else setTimeout(check, 1000);
      });
    }
    check();
  });
}

// ---- App Lifecycle -------------------------------------------------------
app.whenReady().then(async () => {
  // Show splash immediately
  createSplash();

  // Auto-start the infrastructure (llama.cpp dual-worker servers)
  startInfrastructure();

  // Start the Next.js dev server if in dev mode and not already running
  if (IS_DEV) {
    const nextReady = await waitForServer(NEXT_URL, 5000);
    if (!nextReady) {
      console.log("[MiMo X] Starting Next.js dev server...");
      const nextProcess = spawn("npx", ["next", "dev", "-p", "3000"], {
        cwd: path.join(__dirname, ".."),
        detached: true,
        stdio: "ignore",
        shell: true,
      });
      await waitForServer(NEXT_URL, 30000);
    }
  }

  // Wait a bit for the infrastructure to initialize
  await new Promise((r) => setTimeout(r, 3000));

  // Create the main window
  createMainWindow();
});

// Quit when all windows are closed
app.on("window-all-closed", () => {
  if (infraProcess) {
    try { process.kill(-infraProcess.pid); } catch {}
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createSplash();
  }
});

// Clean up infrastructure process on exit
app.on("before-quit", () => {
  if (infraProcess) {
    try { process.kill(-infraProcess.pid); } catch {}
  }
});
