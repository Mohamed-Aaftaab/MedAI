"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { useWorkspace } from "@/components/workspace";
import {
  Amount,
  DataGate,
  Empty,
  paymentLabel,
  Pill,
  Stats,
  TxLink,
} from "@/components/ui";
import { ethSum } from "@/lib/data";

export default function Payments() {
  const { records } = useWorkspace();
  const [filter, setFilter] = useState("All payments");
  const paid = records.filter((r) => r.payment_state || r.payment_tx_hash);
  const rows = [...paid]
    .filter((r) => filter === "All payments" || paymentLabel(r) === filter)
    .sort(
      (a, b) =>
        Date.parse(b.payment_submitted_at || b.created_at) -
        Date.parse(a.payment_submitted_at || a.created_at),
    );
  return (
    <DataGate>
      <Stats
        items={[
          {
            label: "Total ETH sent",
            value: ethSum(records),
            caption: "Verified onchain only",
            eth: true,
          },
          {
            label: "Payment submissions",
            value: paid.length,
            caption: "Campaigns with payment records",
          },
          {
            label: "Verified receipts",
            value: paid.filter((r) => r.payment_verified).length,
            caption: "Receipt verification successful",
          },
          {
            label: "Awaiting verification",
            value: paid.filter(
              (r) => !r.payment_verified && paymentLabel(r) !== "Failed",
            ).length,
            caption: "Pending or uncertain transfers",
          },
        ]}
      />
      <section className="panel ledger reveal">
        <div className="section-head">
          <div className="table-heading">
            <ShieldCheck size={18} />
            <h2>Onchain payment ledger</h2>
          </div>
          <select
            className="standalone-select"
            aria-label="Filter payments"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            {["All payments", "Verified", "Pending", "Unknown", "Failed"].map(
              (f) => (
                <option key={f}>{f}</option>
              ),
            )}
          </select>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>PATIENT / SUBMITTED</th>
                <th>AMOUNT</th>
                <th>STATUS</th>
                <th>TRANSACTION</th>
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
                    <Link
                      className="patient-name"
                      href={`/confirmations/${encodeURIComponent(r.call_id)}`}
                    >
                      {r.patient_name}
                      <small>
                        {r.payment_submitted_at
                          ? new Date(r.payment_submitted_at).toLocaleString()
                          : "Submission time not reported"}
                      </small>
                    </Link>
                  </td>
                  <td>
                    <Amount value={r.payment_amount} />
                  </td>
                  <td>
                    <Pill
                      text={paymentLabel(r)}
                      tone={
                        r.payment_verified
                          ? "green"
                          : paymentLabel(r) === "Failed"
                            ? "amber"
                            : "neutral"
                      }
                    />
                  </td>
                  <td>
                    <TxLink hash={r.payment_tx_hash} />
                  </td>
                  <td>
                    <Link
                      href={`/confirmations/${encodeURIComponent(r.call_id)}`}
                      className="row-arrow"
                      aria-label={`Inspect payment for ${r.patient_name}`}
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
                filter === "All payments"
                  ? "No payments submitted"
                  : "No matching payments"
              }
              text="Authorize a payment from a confirmation. Its execution record and receipt will appear here."
            />
          )}
        </div>
        <div className="ledger-note">
          <ShieldCheck size={14} />
          Only a verified onchain receipt contributes to total ETH sent.
        </div>
      </section>
    </DataGate>
  );
}
