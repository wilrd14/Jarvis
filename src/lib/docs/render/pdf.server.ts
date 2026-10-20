/**
 * PDF: imprime el HTML con el Edge (o Chrome) YA instalado en modo headless. No descarga ni usa
 * ejecutables nuevos (Smart App Control). Perfil temporal propio que se borra siempre, spawn sin
 * shell, tiempo máximo 30 s y sin red (el HTML lleva CSP y además se bloquea la resolución DNS).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import type { DocumentSpec } from "../schema";
import { renderHtml } from "./html.server";

const TIMEOUT_MS = 30_000;

export async function findBrowser(): Promise<string | null> {
  const pf = process.env["ProgramFiles"] ?? "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const local = process.env["LOCALAPPDATA"] ?? "";
  const candidates = [
    path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
    ...(local ? [path.join(local, "Google", "Chrome", "Application", "chrome.exe")] : []),
  ];
  for (const c of candidates) {
    try {
      if ((await fs.stat(c)).isFile()) return c;
    } catch {
      /* siguiente */
    }
  }
  return null;
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  // Solo por PID (nunca por nombre de imagen): cierra el árbol de procesos del navegador.
  const k = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { shell: false, stdio: "ignore", windowsHide: true });
  k.on("error", () => {});
}

/** Ejecuta el navegador y devuelve cuando termina el proceso o vence el tiempo. */
export function runBrowser(exe: string, args: string[], timeoutMs = TIMEOUT_MS): Promise<{ timedOut: boolean; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { shell: false, stdio: "ignore", windowsHide: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
      child.kill();
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ timedOut, code });
    });
  });
}

/** Flags comunes: headless, sin red, sin primer arranque ni telemetría, perfil aislado. */
export function headlessArgs(profile: string): string[] {
  return [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--hide-scrollbars",
    "--host-resolver-rules=MAP * ~NOTFOUND",
    `--user-data-dir=${profile}`,
  ];
}

async function rmQuiet(p: string): Promise<void> {
  for (let i = 0; i < 5; i++) {
    try {
      await fs.rm(p, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

export async function renderPdf(spec: DocumentSpec): Promise<Buffer> {
  if (process.platform !== "win32") throw new Error("La exportación a PDF solo está disponible en Windows.");
  const exe = await findBrowser();
  if (!exe) {
    throw new Error("No encuentro Microsoft Edge ni Google Chrome instalados, y los necesito para crear el PDF.");
  }
  const work = path.join(os.tmpdir(), `jarvis-pdf-${crypto.randomBytes(8).toString("hex")}`);
  await fs.mkdir(work, { recursive: true });
  try {
    const htmlPath = path.join(work, "doc.html");
    const pdfPath = path.join(work, "doc.pdf");
    await fs.writeFile(htmlPath, await renderHtml(spec));
    const args = [
      ...headlessArgs(path.join(work, "profile")),
      "--no-pdf-header-footer",
      `--print-to-pdf=${pdfPath}`,
      pathToFileURL(htmlPath).href,
    ];
    const r = await runBrowser(exe, args);
    let buf: Buffer | null = null;
    try {
      buf = await fs.readFile(pdfPath);
    } catch {
      /* se informa abajo */
    }
    if (!buf || buf.length < 100 || buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
      throw new Error(r.timedOut ? "El navegador tardó demasiado en crear el PDF (30 s)." : "El navegador no pudo crear el PDF.");
    }
    return buf;
  } finally {
    await rmQuiet(work);
  }
}
