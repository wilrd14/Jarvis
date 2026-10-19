import { jsonResponse, providerError } from "@/lib/guard";
import { getSetting } from "@/lib/settings";
import { budgetStatus, getRemoteUsage, sessionUsage, takeBudgetWarning, monthSpend } from "@/lib/usage.server";

export const dynamic = "force-dynamic";

// Solo datos no sensibles: nunca la key ni su etiqueta.
export async function GET() {
  if (!getSetting("openrouterApiKey")) {
    return jsonResponse({ available: false, session: sessionUsage() });
  }
  const remote = await getRemoteUsage();
  if (!remote) return providerError("OpenRouter (gasto)", 502, "sin datos de uso");
  const d = remote.data;
  const budget = budgetStatus(d);
  return jsonResponse({
    available: true,
    cached: remote.cached,
    fetchedAt: d.fetchedAt,
    usage: d.usage,
    daily: d.daily,
    weekly: d.weekly,
    monthly: d.monthly,
    limit: d.limit,
    limitRemaining: d.limitRemaining,
    limitReset: d.limitReset,
    creditsTotal: d.creditsTotal,
    creditsRemaining: d.creditsRemaining,
    spendMonth: monthSpend(d),
    budget: { ...budget, justExceeded: takeBudgetWarning(budget.overBudget) },
    session: sessionUsage(),
  });
}
