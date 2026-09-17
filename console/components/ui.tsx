"use client";
import Link from "next/link";
import {
  ArrowRight,
  AudioLines,
  CheckCheck,
  Copy,
  ExternalLink,
  FlaskConical,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Phone,
  Radio,
  ShieldCheck,
  Wallet,
  Zap,
} from "lucide-react";
import { useWorkspace } from "./workspace";
import type { Confirmation } from "@/lib/data";

export const short = (value: string) =>
  value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
export const completed = (r: Confirmation) =>
  !!r.structured_result?.overall || r.status === "confirmed";
export const paymentLabel = (r: Confirmation) =>
  r.payment_verified
    ? "Verified"
    : r.payment_status === "failed" ||
        ["reverted", "safe_inner_failure"].includes(
          r.payment_receipt_status || "",
        )
      ? "Failed"
      : r.payment_state === "unknown"
        ? "Unknown"
        : r.payment_state
          ? "Pending"
          : "Unpaid";
export const callLabel = (r: Confirmation) =>
  completed(r)
    ? "Completed"
    : {
        not_sent: "Not started",
        submitting: "Submitting",
        submitted: "Submitted",
        unknown: "Unknown",
      }[r.dispatch_state] ||
      r.dispatch_state ||
      "Not reported";
export function Pill({
  text,
  tone = "neutral",
}: {
  text: string;
  tone?: string;
}) {
  return (
    <span className={`pill ${tone}`}>
      <i />
      {text}
    </span>
  );
}
export function Amount({ value }: { value?: string }) {
  const { copy } = useWorkspace();
  return value != null ? (
    <button
      className="amount-button"
      title="Copy ETH amount"
      onClick={() => copy(value)}
    >
      {value}
      <span>ETH</span>
      <Copy size={12} />
    </button>
  ) : (
    <span className="unknown-value">Not reported</span>
  );
}
export function TxLink({ hash }: { hash?: string }) {
  const { copy } = useWorkspace();
  return hash ? (
    <span className="tx-actions">
      <a
        className="mono verified-link"
        title={hash}
        target="_blank"
        rel="noreferrer"
        href={`https://sepolia.etherscan.io/tx/${hash}`}
      >
        {short(hash)}
        <ExternalLink size={12} />
      </a>
      <button aria-label="Copy transaction hash" onClick={() => copy(hash)}>
        <Copy size={12} />
      </button>
    </span>
  ) : (
    <span className="unknown-value">Receipt not available</span>
  );
}
export function DataGate({ children }: { children: React.ReactNode }) {
  const { checking, credential, updated, loading, error } = useWorkspace();
  if (updated) return children;
  return (
    <section className="panel connection-empty reveal" aria-live="polite">
      <span className="empty-symbol">
        {checking || loading ? (
          <LoaderCircle className="spin" size={28} />
        ) : (
          <Link2 size={28} />
        )}
      </span>
      <div className="eyebrow">
        {checking || loading
          ? "CONNECTING TO YOUR WORKSPACE"
          : error
            ? "CONNECTION REQUIRED"
            : "YOUR WORKSPACE IS READY"}
      </div>
      <h2>
        {checking || loading
          ? "Loading your live workspace…"
          : error
            ? "We couldn’t load your backend."
            : "Connect to see your live data."}
      </h2>
      <p>
        {error
          ? "Check that FastAPI is running and your staff token is valid, then use Connection settings above."
          : credential
            ? "Reading confirmations and payment readiness from MedAI."
            : "Use Connect backend above to enter your staff token. Confirmations, payments, and call outcomes will appear after a successful connection."}
      </p>
      <div className="empty-services">
        <span>
          <Wallet size={16} />
          KeeperHub payments
        </span>
        <span>
          <AudioLines size={16} />
          CALL-E voice
        </span>
        <span>
          <ShieldCheck size={16} />
          Onchain receipts
        </span>
      </div>
    </section>
  );
}
export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <CheckCheck size={26} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
export function Stats({
  items,
}: {
  items: {
    label: string;
    value: string | number;
    caption: string;
    eth?: boolean;
  }[];
}) {
  const icons = [CheckCheck, Wallet, Link2, Phone];
  return (
    <section className="stats">
      {items.map((item, i) => {
        const Icon = icons[i % icons.length];
        return (
          <article
            className={`stat-card reveal ${item.eth ? "eth-stat" : ""}`}
            key={item.label}
            style={{ "--order": i } as React.CSSProperties}
          >
            <div className="stat-top">
              {item.label}
              <Icon size={17} />
            </div>
            <div className="stat-value">
              {item.eth ? <Amount value={String(item.value)} /> : item.value}
            </div>
            <div className="stat-caption">{item.caption}</div>
          </article>
        );
      })}
    </section>
  );
}
export function Patient({ record }: { record: Confirmation }) {
  return (
    <Link
      className="patient-cell"
      href={`/confirmations/${encodeURIComponent(record.call_id)}`}
    >
      <span className="patient-avatar">
        {record.patient_name
          .split(" ")
          .map((p) => p[0])
          .slice(0, 2)
          .join("")}
      </span>
      <span className="patient-name">
        {record.patient_name}
        <small>
          {record.medications.map((m) => `${m.name} ${m.dosage}`).join(", ") ||
            "No medication details"}
        </small>
      </span>
    </Link>
  );
}
export function Pipeline() {
  return (
    <section className="pipeline panel reveal">
      <div className="section-head">
        <div>
          <span className="section-kicker">
            <Zap size={15} />
            PAYMENT BEFORE EXECUTION
          </span>
          <h2>Trust is built into every step.</h2>
        </div>
        <span className="powered">
          Powered by <b>KeeperHub</b>
        </span>
      </div>
      <div className="steps">
        {[
          {
            icon: FlaskConical,
            title: "Simulate",
            text: "Validate the transfer",
            tag: "PRECHECK",
          },
          {
            icon: Radio,
            title: "Broadcast",
            text: "Submit to Ethereum",
            tag: "ONCHAIN",
          },
          {
            icon: ShieldCheck,
            title: "Verify",
            text: "Confirm the receipt",
            tag: "PROOF FIRST",
          },
          {
            icon: Phone,
            title: "Call",
            text: "Connect with the patient",
            tag: "CALL-E",
          },
        ].map(({ icon: Icon, title, text, tag }, i) => (
          <div className={`step step-${i}`} key={title}>
            <div className="step-top">
              <div className="step-icon">
                <Icon size={21} />
              </div>
              <span className="step-number">0{i + 1}</span>
              {i < 3 && (
                <div className="flow-line">
                  <span />
                </div>
              )}
            </div>
            <h3>
              {title}
              <span>{tag}</span>
            </h3>
            <p>{text}</p>
          </div>
        ))}
      </div>
      <div className="pipeline-bottom">
        <span>
          <LockKeyhole size={13} />
          No verified payment. No call.
        </span>
        <Link href="/system">
          System readiness <ArrowRight size={13} />
        </Link>
      </div>
    </section>
  );
}
