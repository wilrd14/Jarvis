// Consulta y configura Tailscale con su CLI oficial. Solo argumentos fijos (sin shell) y
// únicamente desde el PC (la ruta que lo usa rechaza el acceso remoto).
import { execFile } from "node:child_process";
import fs from "node:fs";
import { isValidRemoteHost } from "@/lib/remote.server";

const CANDIDATES = [
  "C:\Program Files\Tailscale\tailscale.exe",
  "C:\Program Files (x86)\Tailscale\tailscale.exe",
  "tailscale",
];

function cli(): string | null {
  for (const c of CANDIDATES) {
    if (c === "tailscale" || fs.existsSync(c)) return c;
  }
  return null;
}

function run(args: string[], timeoutMs = 15_000): Promise<{ ok: boolean; out: string }> {
  const bin = cli();
  if (!bin) return Promise.resolve({ ok: false, out: "" });
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: `${stdout}${stderr}`.trim() });
    });
  });
}

export interface TailscaleInfo {
  installed: boolean;
  running: boolean;
  /** Nombre ts.net de este PC (sin punto final) o "". */
  dnsName: string;
  serving: boolean;
}

const jarvisPort = () => String(Number(process.env.PORT) || 3737);

export async function tailscaleInfo(): Promise<TailscaleInfo> {
  const st = await run(["status", "--json"], 8_000);
  if (!st.ok && !st.out.includes("{")) {
    return { installed: CANDIDATES.slice(0, 2).some((c) => fs.existsSync(c)), running: false, dnsName: "", serving: false };
  }
  let dnsName = "";
  let running = false;
  try {
    const j = JSON.parse(st.out.slice(st.out.indexOf("{")));
    running = j.BackendState === "Running";
    const raw = typeof j.Self?.DNSName === "string" ? j.Self.DNSName.replace(/\.$/, "").toLowerCase() : "";
    dnsName = isValidRemoteHost(raw) ? raw : "";
  } catch {
    /* sin datos */
  }
  let serving = false;
  if (running) {
    const sv = await run(["serve", "status"], 8_000);
    serving = sv.ok && sv.out.includes(`127.0.0.1:${jarvisPort()}`);
  }
  return { installed: true, running, dnsName, serving };
}

/** Publica Jarvis en tu red privada con HTTPS (tailscale serve). Devuelve el texto de la CLI. */
export function tailscaleServeOn() {
  return run(["serve", "--bg", `http://127.0.0.1:${jarvisPort()}`], 30_000);
}

export function tailscaleServeOff() {
  return run(["serve", "--https=443", "off"], 15_000);
}
