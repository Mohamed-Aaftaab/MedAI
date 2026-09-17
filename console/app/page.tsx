"use client";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  CheckCheck,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useWorkspace } from "@/components/workspace";
import {
  Amount,
  completed,
  DataGate,
  Empty,
  Patient,
  Pill,
  Pipeline,
  Stats,
} from "@/components/ui";
import { ethSum } from "@/lib/data";

export default function Overview() {
  const { records, readiness } = useWorkspace();
  const paid = records.filter((r) => r.payment_state),
    verified = records.filter((r) => r.payment_verified),
    calls = records.filter(completed);
  const recent = [...records]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 4);
  return (
    <DataGate>
      <Stats
        items={[
          {
            label: "Total confirmations",
            value: records.length,
            caption: "Prescriptions in your workspace",
          },
          {
            label: "Paid campaigns",
            value: paid.length,
            caption: `${verified.length} verified onchain`,
          },
          {
            label: "Total ETH sent",
            value: ethSum(records),
            caption: "Verified transfers only",
            eth: true,
          },
          {
            label: "Calls completed",
            value: calls.length,
            caption: "Confirmation outcomes received",
          },
        ]}
      />
      <Pipeline />
      <div className="overview-grid">
        <section className="panel reveal">
          <div className="section-head">
            <h2>Latest confirmations</h2>
            <Link className="section-link" href="/confirmations">
              View all
              <ArrowRight size={14} />
            </Link>
          </div>
          {recent.length ? (
            recent.map((r, i) => (
              <div
                className="overview-record"
                key={r.call_id}
                style={{ "--order": i } as React.CSSProperties}
              >
                <Patient record={r} />
                <Pill
                  text={r.status}
                  tone={r.status === "confirmed" ? "green" : "neutral"}
                />
              </div>
            ))
          ) : (
            <Empty
              title="No confirmations yet"
              text="New records from your MedAI backend will appear here."
            />
          )}
        </section>
        <section className="panel system reveal">
          <div className="section-head">
            <h2>System readiness</h2>
            <Link href="/system" aria-label="View system readiness">
              <ArrowUpRight size={15} />
            </Link>
          </div>
          {[
            {
              title: "KeeperHub",
              subtitle: "Payment execution",
              ready: readiness?.configured_for_payment,
              icon: Wallet,
            },
            {
              title: "CALL-E",
              subtitle: "Voice confirmation",
              ready: readiness?.configured_for_call,
              icon: AudioLines,
            },
          ].map(({ title, subtitle, ready, icon: Icon }) => (
            <div className="service" key={title}>
              <span className="service-icon">
                <Icon size={17} />
              </span>
              <div>
                {title}
                <small>{subtitle}</small>
              </div>
              <Pill
                text={ready ? "Configured" : "Blocked"}
                tone={ready ? "green" : "amber"}
              />
            </div>
          ))}
          <div className="cost">
            <span>Cost per call</span>
            <Amount value={readiness?.amount_eth} />
          </div>
          <p className="readiness-note">
            Configuration is checked separately from each transfer.
          </p>
        </section>
      </div>
      <div className="destination-grid">
        {[
          {
            href: "/confirmations",
            title: "Review confirmations",
            text: "Prescriptions and patient details",
            icon: CheckCheck,
          },
          {
            href: "/payments",
            title: "Inspect payment receipts",
            text: "Execution records and verification",
            icon: ShieldCheck,
          },
          {
            href: "/calls",
            title: "Follow call outcomes",
            text: "Dispatch and patient responses",
            icon: AudioLines,
          },
        ].map(({ href, title, text, icon: Icon }, i) => (
          <Link
            className="destination panel reveal"
            href={href}
            key={href}
            style={{ "--order": i + 2 } as React.CSSProperties}
          >
            <Icon size={21} />
            <h3>{title}</h3>
            <p>{text}</p>
            <ArrowUpRight className="destination-arrow" size={16} />
          </Link>
        ))}
      </div>
    </DataGate>
  );
}
