"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, ChevronDown, Search } from "lucide-react";
import { useWorkspace } from "@/components/workspace";
import {
  callLabel,
  DataGate,
  Empty,
  Patient,
  paymentLabel,
  Pill,
} from "@/components/ui";

export default function Confirmations() {
  const { records } = useWorkspace();
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("All confirmations");
  const rows = records.filter(
    (r) =>
      `${r.patient_name} ${r.medications.map((m) => m.name).join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "All confirmations" ||
        (filter === "Unpaid"
          ? !r.payment_state
          : filter === "Verified"
            ? r.payment_verified
            : r.status === "review")),
  );
  return (
    <DataGate>
      <section className="panel confirmations reveal">
        <div className="section-head">
          <div className="table-heading">
            <h2>Confirmation queue</h2>
            <span className="count">{records.length}</span>
          </div>
          <span className="quiet-text">
            Select a patient to inspect or authorize a call
          </span>
        </div>
        <div className="table-tools">
          <label className="search">
            <Search size={16} />
            <input
              aria-label="Search patients or medications"
              placeholder="Search patients or medications…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="select-wrap">
            <select
              aria-label="Filter confirmations"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              {["All confirmations", "Unpaid", "Verified", "Needs review"].map(
                (f) => (
                  <option key={f}>{f}</option>
                ),
              )}
            </select>
            <ChevronDown size={13} />
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>PATIENT / MEDICATION</th>
                <th>CONFIRMATION</th>
                <th>PAYMENT</th>
                <th>CALL</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.call_id}
                  style={{ "--order": Math.min(i, 10) } as React.CSSProperties}
                >
                  <td>
                    <Patient record={r} />
                  </td>
                  <td>
                    <Pill
                      text={r.status}
                      tone={
                        r.status === "confirmed"
                          ? "green"
                          : r.status === "review"
                            ? "amber"
                            : "neutral"
                      }
                    />
                  </td>
                  <td>
                    {r.payment_verified && r.payment_tx_hash ? (
                      <a
                        className="verified-link"
                        href={`https://sepolia.etherscan.io/tx/${r.payment_tx_hash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Verified
                        <ArrowUpRight size={12} />
                      </a>
                    ) : (
                      <Pill
                        text={paymentLabel(r)}
                        tone={r.payment_verified ? "green" : "neutral"}
                      />
                    )}
                  </td>
                  <td>{callLabel(r)}</td>
                  <td>
                    <Link
                      className="row-arrow"
                      href={`/confirmations/${encodeURIComponent(r.call_id)}`}
                      aria-label={`View ${r.patient_name}`}
                    >
                      <ArrowUpRight size={16} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <Empty
              title={
                query || filter !== "All confirmations"
                  ? "No matching confirmations"
                  : "No confirmations yet"
              }
              text={
                query || filter !== "All confirmations"
                  ? "Try a different search or filter."
                  : "Records will appear when they are available in your MedAI backend."
              }
            />
          )}
        </div>
        <div className="table-footer">
          <span>
            Showing {rows.length} of {records.length} confirmations
          </span>
          <span>Backend records</span>
        </div>
      </section>
    </DataGate>
  );
}
