/**
 * Lógica de sistema (solo Windows, solo servidor) de las acciones de control
 * del PC. Se carga con `await import()` desde `run` para no entrar en el bundle
 * del navegador. Regla: NUNCA se interpola texto del usuario/modelo en un
 * comando; los ejecutables/URIs salen de tablas fijas, las rutas de carpetas
 * conocidas y los parámetros numéricos viajan por variables de entorno.
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ServerActionResult } from "./types";
import type { AppId } from "./open-app";
import type { FolderId } from "./open-folder";
import type { VolumeMode } from "./volume";

function assertWindows() {
  if (process.platform !== "win32") {
    throw new Error("Esta acción solo está disponible en Windows.");
  }
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** spawn sin shell; el comando y los args son siempre constantes o validados. */
function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  delete env.OPENROUTER_API_KEY;
  delete env.ELEVENLABS_API_KEY;
  return env;
}

function run(
  file: string,
  args: string[],
  opts: { env?: Record<string, string>; timeoutMs?: number } = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      // Los procesos hijos no necesitan (ni deben heredar) las claves de API.
      env: childEnv(opts.env),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("La operación tardó demasiado."));
    }, opts.timeoutMs ?? 15000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

/** PowerShell con el script codificado (sin problemas de comillas). */
function powershell(script: string, env: Record<string, string> = {}, timeoutMs?: number) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
    { env, timeoutMs }
  );
}

// ---------- open_app ----------

/** Objetivos fijos para `cmd /c start "" <target>`; ninguno lleva argumentos del usuario. */
export const APP_TARGETS: Record<AppId, string> = {
  browser: "chrome",
  notepad: "notepad.exe",
  calculator: "calc.exe",
  explorer: "explorer.exe",
  spotify: "spotify:",
  discord: "discord:",
  vscode: "code",
  terminal: "wt.exe",
  settings: "ms-settings:",
  taskmgr: "taskmgr.exe",
};

const APP_NAMES: Record<AppId, string> = {
  browser: "el navegador",
  notepad: "el Bloc de notas",
  calculator: "la Calculadora",
  explorer: "el Explorador de archivos",
  spotify: "Spotify",
  discord: "Discord",
  vscode: "VS Code",
  terminal: "la Terminal",
  settings: "Configuración",
  taskmgr: "el Administrador de tareas",
};

async function _openApp(app: AppId): Promise<ServerActionResult> {
  assertWindows();
  const target = Object.hasOwn(APP_TARGETS, app) ? APP_TARGETS[app] : undefined;
  if (!target) return { ok: false, message: "Aplicación no permitida." };
  // `start` es un comando interno de cmd; el target es una constante de la tabla.
  const r = await run("cmd.exe", ["/d", "/c", "start", '""', target]);
  if (r.code !== 0) {
    return { ok: false, message: `No pude abrir ${APP_NAMES[app]}; quizá no está instalado.` };
  }
  return { ok: true, message: `Abriendo ${APP_NAMES[app]}.` };
}

// ---------- open_folder ----------

const KNOWN_FOLDER_SPECIAL: Partial<Record<FolderId, string>> = {
  documents: "MyDocuments",
  desktop: "Desktop",
  pictures: "MyPictures",
  music: "MyMusic",
  videos: "MyVideos",
};
const FOLDER_DIRNAME: Record<FolderId, string> = {
  documents: "Documents",
  downloads: "Downloads",
  desktop: "Desktop",
  pictures: "Pictures",
  music: "Music",
  videos: "Videos",
};
const FOLDER_NAMES: Record<FolderId, string> = {
  documents: "Documentos",
  downloads: "Descargas",
  desktop: "Escritorio",
  pictures: "Imágenes",
  music: "Música",
  videos: "Videos",
};

/** Carpeta conocida; respeta redirecciones (OneDrive) cuando .NET las resuelve. */
export async function resolveKnownFolder(folder: FolderId): Promise<string> {
  assertWindows();
  const fallback = path.join(os.homedir(), FOLDER_DIRNAME[folder]);
  const special = KNOWN_FOLDER_SPECIAL[folder];
  if (!special) {
    // Descargas no está en el enum de .NET: se usa la ruta estándar del perfil.
    return fallback;
  }
  try {
    const r = await powershell(`[Environment]::GetFolderPath('${special}')`, {}, 8000);
    const p = r.stdout.split(/\r?\n/)[0]?.trim();
    if (r.code === 0 && p && path.isAbsolute(p)) return p;
  } catch {
    /* usar fallback */
  }
  return fallback;
}

async function _openKnownFolder(folder: FolderId): Promise<ServerActionResult> {
  assertWindows();
  if (!Object.hasOwn(FOLDER_DIRNAME, folder)) return { ok: false, message: "Carpeta no permitida." };
  const dir = await resolveKnownFolder(folder);
  const st = await fs.stat(dir).catch(() => null);
  if (!st?.isDirectory()) return { ok: false, message: `No encontré la carpeta ${FOLDER_NAMES[folder]}.` };
  // explorer.exe devuelve código 1 aunque abra bien: no se comprueba.
  const child = spawn("explorer.exe", [dir], { shell: false, detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
  return { ok: true, message: `Abriendo ${FOLDER_NAMES[folder]}.` };
}

// ---------- volume ----------

const VOLUME_STEP = 10;

// Mínimo COM de Core Audio (IAudioEndpointVolume) compilado con Add-Type.
const VOLUME_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr p);
  int UnregisterControlChangeNotify(IntPtr p);
  int GetChannelCount(out uint n);
  int SetMasterVolumeLevel(float db, ref Guid ctx);
  int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
  int GetMasterVolumeLevel(out float db);
  int GetMasterVolumeLevelScalar(out float level);
  int SetChannelVolumeLevel(uint ch, float db, ref Guid ctx);
  int SetChannelVolumeLevelScalar(uint ch, float level, ref Guid ctx);
  int GetChannelVolumeLevel(uint ch, out float db);
  int GetChannelVolumeLevelScalar(uint ch, out float level);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
  int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
  int Activate(ref Guid iid, int clsCtx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int flow, int mask, out IntPtr devs);
  int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice dev);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
public class MMDeviceEnumeratorCom { }
public static class JarvisVolume {
  static IAudioEndpointVolume Get() {
    var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
    IMMDevice dev; Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 1, out dev));
    Guid iid = typeof(IAudioEndpointVolume).GUID; object o;
    Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o));
    return (IAudioEndpointVolume)o;
  }
  public static int Level() { float f; Marshal.ThrowExceptionForHR(Get().GetMasterVolumeLevelScalar(out f)); return (int)Math.Round(f * 100); }
  public static bool Muted() { bool m; Marshal.ThrowExceptionForHR(Get().GetMute(out m)); return m; }
  public static void SetLevel(int pct) { Guid g = Guid.Empty; Marshal.ThrowExceptionForHR(Get().SetMasterVolumeLevelScalar(pct / 100f, ref g)); }
  public static void SetMute(bool m) { Guid g = Guid.Empty; Marshal.ThrowExceptionForHR(Get().SetMute(m, ref g)); }
}
"@
$mode = $env:JARVIS_VOL_MODE
$level = [int]$env:JARVIS_VOL_LEVEL
$step = [int]$env:JARVIS_VOL_STEP
switch ($mode) {
  'up'     { $n = [Math]::Min(100, [JarvisVolume]::Level() + $step); [JarvisVolume]::SetLevel($n); [JarvisVolume]::SetMute($false) }
  'down'   { $n = [Math]::Max(0, [JarvisVolume]::Level() - $step); [JarvisVolume]::SetLevel($n) }
  'set'    { [JarvisVolume]::SetLevel([Math]::Max(0, [Math]::Min(100, $level))); if ($level -gt 0) { [JarvisVolume]::SetMute($false) } }
  'mute'   { [JarvisVolume]::SetMute($true) }
  'unmute' { [JarvisVolume]::SetMute($false) }
  'get'    { }
  default  { throw 'modo no valido' }
}
Write-Output ('{0}|{1}' -f [JarvisVolume]::Level(), [JarvisVolume]::Muted())
`;

export interface VolumeState {
  level: number;
  muted: boolean;
}

export async function runVolume(mode: VolumeMode | "get", level?: number): Promise<VolumeState> {
  assertWindows();
  const lvl = mode === "set" ? Math.max(0, Math.min(100, Math.trunc(level ?? 0))) : 0;
  const r = await powershell(VOLUME_SCRIPT, {
    JARVIS_VOL_MODE: mode,
    JARVIS_VOL_LEVEL: String(lvl),
    JARVIS_VOL_STEP: String(VOLUME_STEP),
  }, 30000);
  const m = /(\d+)\|(True|False)\s*$/.exec(r.stdout);
  if (r.code !== 0 || !m) throw new Error("No pude controlar el volumen del sistema.");
  return { level: Number(m[1]), muted: m[2] === "True" };
}

async function _setVolume(mode: VolumeMode, level?: number): Promise<ServerActionResult> {
  const s = await runVolume(mode, level);
  const text = s.muted ? "Sonido silenciado." : `Volumen al ${s.level}%.`;
  return { ok: true, message: text };
}

// ---------- lock_screen ----------

export const LOCK_COMMAND = { file: "rundll32.exe", args: ["user32.dll,LockWorkStation"] } as const;

async function _lockScreen(): Promise<ServerActionResult> {
  assertWindows();
  const child = spawn(LOCK_COMMAND.file, [...LOCK_COMMAND.args], {
    shell: false,
    detached: true,
    stdio: "ignore",
  });
  child.on("error", () => {});
  child.unref();
  return { ok: true, message: "Bloqueando la pantalla." };
}

// ---------- screenshot ----------

const SCREENSHOT_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class JarvisDpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
[void][JarvisDpi]::SetProcessDPIAware()
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
$bmp.Save($env:JARVIS_SHOT_PATH, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
`;

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

async function _takeScreenshot(): Promise<ServerActionResult> {
  assertWindows();
  const dir = path.join(await resolveKnownFolder("pictures"), "Jarvis");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `captura_${stamp()}.png`);
  const r = await powershell(SCREENSHOT_SCRIPT, { JARVIS_SHOT_PATH: file }, 30000);
  const st = await fs.stat(file).catch(() => null);
  if (r.code !== 0 || !st || st.size === 0) {
    throw new Error("No pude tomar la captura de pantalla.");
  }
  return { ok: true, message: `Captura guardada en ${file}` };
}

// ---------- API pública: los errores se devuelven como resultado claro ----------

async function safe(fn: () => Promise<ServerActionResult>): Promise<ServerActionResult> {
  try {
    return await fn();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Falló la acción del sistema." };
  }
}

export const openApp = (app: AppId) => safe(() => _openApp(app));
export const openKnownFolder = (folder: FolderId) => safe(() => _openKnownFolder(folder));
export const setVolume = (mode: VolumeMode, level?: number) => safe(() => _setVolume(mode, level));
export const lockScreen = () => safe(() => _lockScreen());
export const takeScreenshot = () => safe(() => _takeScreenshot());
