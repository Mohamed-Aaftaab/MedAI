"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, AudioLines, CheckCheck, Phone } from "lucide-react";
import { useWorkspace } from "@/components/workspace";
import {
  callLabel,
  completed,
  DataGate,
  Empty,
  Pill,
  Stats,
} from "@/components/ui";

export default function Calls() {
  const { records } = useWorkspace();
  const [filter, setFilter] = useState("All calls");
  const calls = records.filter(
    (r) => r.dispatch_state !== "not_sent" || completed(r),
  );
  const rows = calls.filter(
    (r) =>
      filter === "All calls" ||
      (filter === "Completed" ? completed(r) : !completed(r)),
  );
  return (
    <DataGate>
      <Stats
        items={[
          {
            label: "Dispatched calls",
            value: calls.length,
            caption: "Submitted or with reported outcomes",
          },
          {
            label: "Completed",
            value: calls.filter(completed).length,
            caption: "A final outcome is available",
          },
          {
            label: "Confirmed prescriptions",
            value: records.filter((r) => r.status === "confirmed").length,
            caption: "Confirmed by the backend",
          },
          {
            label: "Needs review",
            value: records.filter(
              (r) => r.status === "review" || r.status === "fallback",
            ).length,
            caption: "Review and fallback confirmations",
          },
        ]}
      />
      <div className="call-section-head reveal">
        <div>
          <AudioLines size={20} />
          <h2>Call activity</h2>
        </div>
        <select
          className="standalone-select"
          aria-label="Filter calls"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          {["All calls", "Completed", "Awaiting outcome"].map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </div>
      {rows.length ? (
        <div className="call-grid">
          {rows.map((r, i) => (
            <article
              className="panel call-card reveal"
              key={r.call_id}
              style={{ "--order": Math.min(i, 8) } as React.CSSProperties}
            >
              <div className="call-card-top">
                <span className="call-orbit">
                  {completed(r) ? (
                    <CheckCheck size={23} />
                  ) : (
                    <Phone size={23} />
                  )}
                </span>
                <Pill
                  text={callLabel(r)}
                  tone={completed(r) ? "green" : "neutral"}
                />
              </div>
              <Link href={`/confirmations/${encodeURIComponent(r.call_id)}`}>
                <h2>{r.patient_name}</h2>
              </Link>
              <p className="mono">{r.phone_number}</p>
              <div className="outcome-summary">
                <span className="detail-label">PATIENT OUTCOME</span>
                <h3>
                  {r.structured_result?.overall || "Awaiting call result"}
                </h3>
                <p>
                  {r.structured_result?.patient_notes ||
                    (r.structured_result?.reached_patient
                      ? `Reached patient: ${r.structured_result.reached_patient}`
                      : "The backend has not reported a patient response.")}
                </p>
              </div>
              <div className="call-card-footer">
                <span>
                  {r.medications.length} medication
                  {r.medications.length === 1 ? "" : "s"}
                </span>
                <Link href={`/confirmations/${encodeURIComponent(r.call_id)}`}>
                  View confirmation
                  <ArrowUpRight size={14} />
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="panel reveal">
          <Empty
            title="No calls to show"
            text="Calls appear here after a payment has been verified and the backend dispatches the confirmation call."
          />
        </section>
      )}
    </DataGate>
  );
}
