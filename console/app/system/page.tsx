"use client";
import { useEffect, useState } from "react";
import { AudioLines, RefreshCw, Wallet } from "lucide-react";
import { backend, useWorkspace } from "@/components/workspace";
import { Amount, DataGate, Pill, Pipeline } from "@/components/ui";

type CallReadiness = {
  configured_for_live: boolean;
  blockers: string[];
  local_budget: unknown;
  reserved_calls: unknown;
  worker: Record<string, unknown>;
};
export default function System() {
  const { readiness, updated, credential, busy } = useWorkspace();
  const [call, setCall] = useState<CallReadiness | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!credential || !updated) return;
    let active = true;
    backend<CallReadiness>("local/readiness")
      .then((data) => {
        if (active) {
          setCall(data);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [credential, updated]);
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
      <p className="system-disclaimer reveal">
        {readiness?.note ||
          "Configuration is not proof a transfer will land. No KeeperHub request is made by this check."}
        {busy && " A campaign request is in progress."}
      </p>
    </DataGate>
  );
}
