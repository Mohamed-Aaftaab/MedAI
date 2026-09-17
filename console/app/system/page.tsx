"use client";
import { useCallback, useEffect, useState } from "react";
import { AudioLines, CheckCheck, LoaderCircle, RefreshCw, Wallet } from "lucide-react";
import { backend, useWorkspace } from "@/components/workspace";
import { Amount, DataGate, Pill, Pipeline } from "@/components/ui";
import type { Config } from "@/lib/data";

type CallReadiness = {
  configured_for_live: boolean;
  blockers: string[];
  local_budget: unknown;
  reserved_calls: unknown;
  worker: Record<string, unknown>;
};

const FACT_LABELS: [keyof Config["calling"] | "tenant" | "database" | "scheduled_jobs" | "due_jobs" | "named_staff_keys" | "legacy_demo_enabled", string, (c: Config) => string][] = [
  ["enabled", "Live calling", (c) => (c.calling.enabled ? "Enabled" : "Disabled")],
  ["allowed_phone_count", "Allowed numbers", (c) => `${c.calling.allowed_phone_count} number(s) on the allowlist`],
  ["verified_locales", "Verified locales", (c) => c.calling.verified_locales.join(", ") || "none configured"],
  ["provider_host", "Provider host", (c) => c.calling.provider_host || "unset"],
  ["callback_host", "Webhook callback host", (c) => c.calling.callback_host || "unset — outcomes must be read back by hand"],
  ["tenant", "Workspace tenant", (c) => c.storage.tenant || "—"],
  ["database", "Database file", (c) => c.storage.database || "—"],
  ["scheduled_jobs", "Reminders stored", (c) => `${c.storage.scheduled_jobs} saved, ${c.storage.due_jobs} due now`],
  ["named_staff_keys", "Staff authentication", (c) => (c.auth.named_staff_keys ? "Named staff keys" : "Single shared staff token")],
  ["legacy_demo_enabled", "Legacy demo endpoints", (c) => (c.auth.legacy_demo_enabled ? "Enabled" : "Disabled")],
];

export default function System() {
  const { readiness, updated, credential, busy } = useWorkspace();
  const [call, setCall] = useState<CallReadiness | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState("");
  const [limit, setLimit] = useState("");
  const [savingBudget, setSavingBudget] = useState(false);
  const [budgetNotice, setBudgetNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const [c, cfg] = await Promise.all([
        backend<CallReadiness>("local/readiness"),
        backend<Config>("local/config"),
      ]);
      setCall(c);
      setConfig(cfg);
      setLimit(String(cfg.calling.working_limit));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!credential || !updated) return;
    void load();
  }, [credential, updated, load]);

  async function saveBudget(e: React.FormEvent) {
    e.preventDefault();
    setSavingBudget(true);
    setBudgetNotice("");
    try {
      const r = await backend<{ working_limit: number; ceiling: number; reserved: number }>(
        "local/config/budget",
        "POST",
        { limit: Number(limit) },
      );
      setBudgetNotice(
        `Working call limit set to ${r.working_limit}. ${Math.max(0, r.working_limit - r.reserved)} call(s) available now.`,
      );
      await load();
    } catch (e) {
      setBudgetNotice((e as Error).message);
    } finally {
      setSavingBudget(false);
    }
  }

  return (
    <DataGate>
      <div className="system-grid">
        {[
          {
            title: "KeeperHub",
            subtitle: "Onchain payment execution",
            icon: Wallet,
            ready: readiness?.configured_for_payment,
            blockers: readiness?.keeperhub_blockers || [],
          },
          {
            title: "CALL-E",
            subtitle: "Voice confirmation service",
            icon: AudioLines,
            ready: readiness?.configured_for_call,
            blockers: readiness?.call_blockers || [],
          },
        ].map(({ title, subtitle, icon: Icon, ready, blockers }, i) => (
          <section
            className="panel service-detail reveal"
            key={title}
            style={{ "--order": i } as React.CSSProperties}
          >
            <div className="service-detail-top">
              <span className="service-icon">
                <Icon size={24} />
              </span>
              <Pill
                text={ready ? "Configured" : "Blocked"}
                tone={ready ? "green" : "amber"}
              />
            </div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
            {blockers.length ? (
              <ul className="blocker-list">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            ) : (
              <p className="service-clear">
                No configuration blockers reported.
              </p>
            )}
            {title === "KeeperHub" && (
              <div className="cost">
                <span>Configured payment</span>
                <Amount value={readiness?.amount_eth} />
              </div>
            )}
          </section>
        ))}
      </div>
      <Pipeline />

      <section className="panel detail-section reveal">
        <div className="section-title">
          <h2>Call budget</h2>
          <Pill
            text={
              config ? `${Math.max(0, config.calling.working_limit - config.calling.reserved)} available` : "—"
            }
            tone={config && config.calling.working_limit - config.calling.reserved > 0 ? "green" : "amber"}
          />
        </div>
        <p className="form-note">
          The working limit lives in this workspace&apos;s database and
          applies immediately, with no restart. <code>CALLE_CALL_BUDGET</code>{" "}
          in <code>.env</code> is the hard ceiling: this can lower the working
          limit, never raise it past that. Reserved calls are never released.
        </p>
        {config && (
          <form onSubmit={saveBudget}>
            <div className="budget-grid" style={{ marginTop: 14 }}>
              <div className="field">
                <label>Working call limit</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label>Hard ceiling from .env</label>
                <input readOnly value={config.calling.ceiling} />
              </div>
              <div className="field">
                <label>Calls already reserved</label>
                <input readOnly value={config.calling.reserved} />
              </div>
              <div className="field">
                <label>Available to place</label>
                <input
                  readOnly
                  value={Math.max(0, config.calling.working_limit - config.calling.reserved)}
                />
              </div>
            </div>
            <button className="primary detail-action" disabled={savingBudget} style={{ marginTop: 14 }}>
              {savingBudget ? <LoaderCircle size={15} className="spin" /> : <CheckCheck size={15} />}
              Save working limit
            </button>
            {budgetNotice && <p className="form-note" style={{ marginTop: 10 }}>{budgetNotice}</p>}
          </form>
        )}
      </section>

      <section className="panel worker-panel reveal">
        <div className="section-head">
          <h2>Voice worker details</h2>
          <span className="quiet-text">CALL-E readiness</span>
        </div>
        {error ? (
          <p role="alert" className="blocker">
            {error}
          </p>
        ) : call ? (
          <>
            <div className="worker-summary">
              <Pill
                text={
                  call.configured_for_live
                    ? "Configured for live calls"
                    : "Live calls blocked"
                }
                tone={call.configured_for_live ? "green" : "amber"}
              />
              <span>
                Local budget{" "}
                <b>
                  {typeof call.local_budget === "object"
                    ? JSON.stringify(call.local_budget)
                    : String(call.local_budget ?? "Not reported")}
                </b>
              </span>
              <span>
                Reserved calls{" "}
                <b>{String(call.reserved_calls ?? "Not reported")}</b>
              </span>
            </div>
            {call.blockers?.map((b) => (
              <p className="blocker" key={b}>
                {b}
              </p>
            ))}
            <dl className="worker-details">
              {Object.entries(call.worker || {}).map(([key, value]) => (
                <div key={key}>
                  <dt>{key.replaceAll("_", " ")}</dt>
                  <dd>
                    {typeof value === "object"
                      ? JSON.stringify(value)
                      : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <p className="worker-loading">
            <RefreshCw className="spin" size={15} />
            Loading worker status…
          </p>
        )}
      </section>

      {config && (
        <section className="panel detail-section reveal">
          <div className="section-title">
            <h2>Environment</h2>
          </div>
          <p className="form-note">
            Read-only. Keys, tokens and phone numbers are never sent to the
            browser. Everything here comes from <code>.env</code> and needs a
            server restart to change.
          </p>
          <dl className="config-facts">
            {FACT_LABELS.map(([key, label, resolve]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{resolve(config)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <p className="system-disclaimer reveal">
        {readiness?.note ||
          "Configuration is not proof a transfer will land. No KeeperHub request is made by this check."}
        {busy && " A campaign request is in progress."}
      </p>
    </DataGate>
  );
}
