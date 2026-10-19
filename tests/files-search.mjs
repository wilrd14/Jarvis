// file_search solo mira nombres (lectura): se prueba que no revienta, respeta el tiempo y no lista archivos sensibles.
import { post, check, summary } from "./lib.mjs";

for (const query of ["zzznoexiste987", "informe", "..", "*", "password", ".env"]) {
  const t = Date.now();
  const r = await post("/api/actions/execute", { action: { type: "file_search", query } });
  check(
    `file_search "${query}": responde en <8 s sin 5xx`,
    r.status < 500 && Date.now() - t < 8000,
    `${r.status} ${Date.now() - t} ms ${r.json?.message ?? r.json?.error ?? ""}`
  );
  if (query === "password" || query === ".env") {
    const names = (r.json?.followUp ?? "").split("\n").slice(1).join("\n");
    check(`file_search "${query}": no lista archivos sensibles`, !/password|passw|\.env|secret|credential|token|\.pem/i.test(names), "");
  }
}
process.exit(summary() ? 1 : 0);
