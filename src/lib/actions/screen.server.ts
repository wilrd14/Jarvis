/**
 * "Entender la pantalla": captura la pantalla completa en un archivo temporal
 * dentro de JARVIS_DATA_DIR que SIEMPRE se borra, la reduce a un ancho
 * razonable y se la manda al modelo de visión de OpenRouter.
 * La captura nunca se guarda en Imágenes ni se conserva.
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { dataDir, getSetting } from "../settings.ts";
import { providerError, rateLimit } from "../guard.ts";
import type { ServerActionResult } from "./types.ts";
import { askVisionModel, VisionError } from "./screen-vision.server.ts";

const MAX_WIDTH = 1600;
const MAX_BYTES = 6 * 1024 * 1024;

// Captura la pantalla virtual completa y la reduce (ancho máx. MAX_WIDTH) a un PNG.
const CAPTURE_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class JarvisDpi2 { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
[void][JarvisDpi2]::SetProcessDPIAware()
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
$g.Dispose()
$max = [int]$env:JARVIS_SHOT_MAXW
$out = $bmp
if ($bmp.Width -gt $max) {
  $h = [int][Math]::Round($bmp.Height * $max / $bmp.Width)
  $out = New-Object System.Drawing.Bitmap $max, $h
  $g2 = [System.Drawing.Graphics]::FromImage($out)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g2.DrawImage($bmp, 0, 0, $max, $h)
  $g2.Dispose()
}
$out.Save($env:JARVIS_SHOT_PATH, [System.Drawing.Imaging.ImageFormat]::Png)
if ($out -ne $bmp) { $out.Dispose() }
$bmp.Dispose()
`;

function runPowershell(script: string, env: Record<string, string>, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env, ...env };
    delete childEnv.OPENROUTER_API_KEY;
    delete childEnv.ELEVENLABS_API_KEY;
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      { shell: false, windowsHide: true, stdio: ["ignore", "ignore", "ignore"], env: childEnv }
    );
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("timeout"));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

/**
 * Captura la pantalla y devuelve los bytes del PNG reducido. El archivo
 * temporal vive en <JARVIS_DATA_DIR>/tmp y se borra siempre (finally).
 * `onTempPath` permite comprobar en pruebas que se borró.
 */
export async function captureScreenPng(onTempPath?: (file: string) => void): Promise<Buffer> {
  if (process.platform !== "win32") throw new Error("Esta acción solo está disponible en Windows.");
  const dir = path.join(dataDir(), "tmp");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `screen_${randomBytes(8).toString("hex")}.png`);
  onTempPath?.(file);
  try {
    const code = await runPowershell(
      CAPTURE_SCRIPT,
      { JARVIS_SHOT_PATH: file, JARVIS_SHOT_MAXW: String(MAX_WIDTH) },
      30_000
    );
    const buf = await fs.readFile(file).catch(() => null);
    if (code !== 0 || !buf || buf.length === 0) throw new Error("No pude capturar la pantalla.");
    return buf;
  } finally {
    await fs.rm(file, { force: true }).catch(() => {});
  }
}

export async function askAboutScreen(question: string): Promise<ServerActionResult> {
  if (!rateLimit("screen_ask", 6)) {
    return { ok: false, message: "Demasiadas consultas de pantalla seguidas, espera un momento." };
  }
  const apiKey = getSetting("openrouterApiKey");
  if (!apiKey) return { ok: false, message: "Falta la API key de OpenRouter en Ajustes." };
  let png: Buffer;
  try {
    png = await captureScreenPng();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "No pude capturar la pantalla." };
  }
  if (png.length > MAX_BYTES) return { ok: false, message: "La captura es demasiado grande." };
  try {
    const answer = await askVisionModel({
      apiKey,
      model: getSetting("visionModel"),
      image: png,
      mime: "image/png",
      question,
    });
    return { ok: true, message: answer };
  } catch (e) {
    if (e instanceof VisionError) {
      const r = providerError("visión", e.status, e.detail);
      const body = (await r.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, message: body?.error ?? "No pude analizar la pantalla." };
    }
    console.error("[visión] fallo:", e instanceof Error ? e.name : "desconocido");
    return { ok: false, message: "No pude analizar la pantalla, intenta de nuevo." };
  }
}
