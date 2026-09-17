"use client";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCheck,
  LoaderCircle,
  Phone,
  PhoneCall,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { ApiError, backend, useWorkspace } from "./workspace";
import {
  Amount,
  callLabel,
  DataGate,
  Empty,
  paymentLabel,
  Pill,
  short,
  TxLink,
} from "./ui";
import { Modal } from "./shell";
import type { Confirmation, Medication } from "@/lib/data";

type Preview = { task: string | null; live_blockers: string[] };
type Reconcile =
  | { status: "active"; call_status: string; dial_attempts: number; submitted_at?: string }
  | { status: "processed"; call_status: string; disposition: string };

const FALLBACK_REASONS: Record<string, string> = {
  unsupported_language: "This language is not yet verified for calls. Review the prescription manually.",
  medication_limit: "This prescription needs staff review because of its length.",
  consent_withdrawn: "The patient withdrew consent.",
};

function emptyMed(): Medication {
  return { name: "", dosage: "", quantity: "", schedule: [], duration: "", instructions: "" };
}

export function ConfirmationDetail({ callId }: { callId: string }) {
  const {
    records,
    readiness,
    refresh,
    updateRecord,
    busy,
    setBusy,
    error,
    uncertain,
    markUncertain,
    copy,
  } = useWorkspace();
  const [confirm, setConfirm] = useState(false),
    [actionError, setActionError] = useState(""),
    [notice, setNotice] = useState("");
  const record = records.find((r) => r.call_id === callId);
  const ready =
    !!readiness?.configured_for_payment &&
    !!readiness?.configured_for_call &&
    readiness.chain_id === "11155111";
  const canPay =
    !!record &&
    ready &&
    !error &&
    !record.payment_state &&
    !uncertain.includes(callId) &&
    record.dispatch_state === "not_sent";

  // --- KeeperHub payment + call (existing) -------------------------------
  async function action(kind: "pay" | "payment/reconcile") {
    if (!record || busy || (kind === "pay" && !canPay)) return;
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      const result = await backend<
        Confirmation | { payment: Confirmation; call: Confirmation }
      >(`campaigns/${encodeURIComponent(callId)}/${kind}`, "POST");
      const next =
        "payment" in result ? { ...result.payment, ...result.call } : result;
      updateRecord(next);
      setConfirm(false);
      setNotice(
        kind === "pay"
          ? `Backend response received. Payment: ${paymentLabel(next).toLowerCase()}. Call: ${callLabel(next).toLowerCase()}.`
          : `Payment checked: ${paymentLabel(next).toLowerCase()}.`,
      );
      await refresh();
    } catch (e) {
      const failure = e as Error;
      if (kind === "pay" && (!(e instanceof ApiError) || e.status >= 500))
        markUncertain(callId);
      setConfirm(false);
      await refresh();
      setActionError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  // --- Direct (non-KeeperHub) call preview + dispatch ---------------------
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  async function loadPreview() {
    setPreviewing(true);
    setActionError("");
    try {
      setPreview(
        await backend<Preview>(
          `local/confirmations/${encodeURIComponent(callId)}/preview`,
        ),
      );
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setPreviewing(false);
    }
  }
  const callsAvailable = !!readiness?.configured_for_call;
  async function directDispatch() {
    if (!record || busy) return;
    setBusy(true);
    setActionError("");
    try {
      const next = await backend<Confirmation>(
        `local/confirmations/${encodeURIComponent(callId)}/dispatch`,
        "POST",
        {},
      );
      updateRecord(next);
      setPreview(null);
      setNotice(
        "Call submitted to the provider. Check the outcome once the call ends.",
      );
      await refresh();
    } catch (e) {
      setActionError((e as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  // --- Outcome reconciliation (non-KeeperHub calls) ------------------------
  const [checking, setChecking] = useState(false);
  async function checkOutcome() {
    setChecking(true);
    setActionError("");
    try {
      const r = await backend<Reconcile>(
        `local/confirmations/${encodeURIComponent(callId)}/reconcile`,
        "POST",
        {},
      );
      if (r.status === "active") {
        const never = r.dial_attempts === 0;
        setNotice(
          never
            ? `The provider accepted this call but has not attempted to dial even once (status: ${r.call_status}). Check that calling credit and outbound calling are enabled for this number's region.`
            : `The provider still reports this call as ${r.call_status} after ${r.dial_attempts} dial attempt(s). Check again once it ends.`,
        );
      } else {
        await refresh();
        setNotice(`Call ${r.call_status}. Disposition: ${r.disposition}.`);
      }
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }

  // --- Staff correction / approval -----------------------------------------
  const [correction, setCorrection] = useState<Medication[] | null>(null);
  const [reason, setReason] = useState("");
  const [approving, setApproving] = useState(false);
  function startCorrection() {
    setCorrection(record ? record.medications.map((m) => ({ ...m })) : [emptyMed()]);
    setReason("");
    setActionError("");
  }
  function updateCorrectionMed(i: number, patch: Partial<Medication>) {
    setCorrection((prev) =>
      prev ? prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)) : prev,
    );
  }
  async function approve(e: React.FormEvent) {
    e.preventDefault();
    if (!record || !correction) return;
    setApproving(true);
    setActionError("");
    try {
      const next = await backend<Confirmation>(
        `local/confirmations/${encodeURIComponent(callId)}/approve`,
        "POST",
        { medications: correction, reason, version: record.version },
      );
      updateRecord(next);
      setCorrection(null);
      setNotice("Prescription approved. You can now schedule reminders.");
      await refresh();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setApproving(false);
    }
  }

  // --- Schedule a reminder ---------------------------------------------------
  const [dueAt, setDueAt] = useState("");
  const [medName, setMedName] = useState("");
  const [scheduling, setScheduling] = useState(false);
  async function schedule(e: React.FormEvent) {
    e.preventDefault();
    if (!record || !dueAt || !medName) return;
    setScheduling(true);
    setActionError("");
    try {
      const iso = new Date(dueAt).toISOString();
      const next = await backend<Confirmation>(
        `local/confirmations/${encodeURIComponent(callId)}/schedule`,
        "POST",
        { due_at: [iso], medication_names: [medName], version: record.version },
      );
      updateRecord(next);
      setDueAt("");
      setNotice("Reminder saved.");
      await refresh();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setScheduling(false);
    }
  }

  function paymentInfo() {
    if (!record) return null;
    return (
      <section className="panel detail-section payment-detail reveal">
        <div className="section-title">
          <h2>Onchain payment</h2>
          <Pill
            text={paymentLabel(record)}
            tone={record.payment_verified ? "green" : "neutral"}
          />
        </div>
        <div className="receipt">
          <div>
            <span>{record.payment_state ? "Amount" : "Configured amount"}</span>
            <Amount value={record.payment_amount || readiness?.amount_eth} />
          </div>
          <div>
            <span>Network</span>
            <span>
              {(record.payment_chain_id || readiness?.chain_id) === "11155111"
                ? "Ethereum Sepolia"
                : `Chain ${record.payment_chain_id || readiness?.chain_id || "not reported"}`}
            </span>
          </div>
          {record.payment_state && (
            <div>
              <span>Transaction</span>
              <TxLink hash={record.payment_tx_hash} />
            </div>
          )}
          {(
            [
              ["Execution", record.payment_execution_id],
              ["Recipient", record.payment_recipient],
              ["Block", record.payment_block_number],
              ["Gas used", record.payment_gas_used],
              ["Receipt", record.payment_receipt_status],
              ["Submitted", record.payment_submitted_at],
              ["Reconciled", record.payment_reconciled_at],
            ] as [string, string | number | undefined][]
          ).map(
            ([label, value]) =>
              value != null && (
                <div key={label}>
                  <span>{label}</span>
                  <button
                    className="mono"
                    title={`Copy ${label}: ${value}`}
                    onClick={() => copy(String(value))}
                  >
                    {short(String(value))}
                  </button>
                </div>
              ),
          )}
        </div>
        {record.payment_state || uncertain.includes(callId) ? (
          <>
            <button
              className="primary full detail-action"
              disabled={busy}
              onClick={() => void action("payment/reconcile")}
            >
              <RefreshCw size={15} className={busy ? "spin" : ""} />
              Check payment status
            </button>
            {uncertain.includes(callId) && !record.payment_state && (
              <p className="form-note">
                The previous response was uncertain. Reconcile the payment
                before attempting any further dispatch.
              </p>
            )}
          </>
        ) : (
          <>
            <button
              className="primary full detail-action"
              disabled={!canPay || busy}
              onClick={() => setConfirm(true)}
            >
              <Wallet size={16} />
              Pay via KeeperHub
              <ArrowRight size={15} />
            </button>
            {!ready && (
              <p className="blocker">
                Payment and calling must be configured on Sepolia before
                dispatch. <Link href="/system">Inspect system readiness.</Link>
              </p>
            )}
            {record.dispatch_state !== "not_sent" && (
              <p className="form-note">
                A call has already entered dispatch. Another payment is
                disabled.
              </p>
            )}
          </>
        )}
      </section>
    );
  }

  function callSection() {
    if (!record) return null;
    return (
      <section className="panel detail-section reveal">
        <div className="section-title">
          <h2>Call outcome</h2>
          <Pill text={callLabel(record)} />
        </div>
        {record.structured_result ? (
          <div className="outcome">
            <CheckCheck size={20} />
            <div>
              <b>{record.structured_result.overall || "Result received"}</b>
              <p>
                Reached patient: {record.structured_result.reached_patient || "Not reported"}
              </p>
              {record.structured_result.patient_notes && (
                <p>{record.structured_result.patient_notes}</p>
              )}
              {!!record.structured_result.medications?.length && (
                <details>
                  <summary>Medication responses</summary>
                  <pre>{JSON.stringify(record.structured_result.medications, null, 2)}</pre>
                </details>
              )}
            </div>
          </div>
        ) : (
          <p>The backend has not reported a call outcome yet.</p>
        )}
        {record.provider_id && (
          <div className="provider-id">
            Provider ID{" "}
            <button className="mono" title="Copy provider ID" onClick={() => copy(record.provider_id!)}>
              {record.provider_id}
            </button>
          </div>
        )}
        {record.dispatch_state === "unknown" && (
          <p className="form-note">
            The provider never confirmed this submission, so the call may
            still have been placed. The reserved call is kept and this
            console will not redial. Reconcile with the provider before any
            retry.
          </p>
        )}
        {record.dispatch_state === "submitted" && (
          <>
            <p className="form-note">
              The provider accepted this call. That is not proof the phone
              connected — read the outcome back from the provider.
            </p>
            <button className="secondary" disabled={checking} onClick={() => void checkOutcome()}>
              {checking ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
              Check outcome with provider
            </button>
          </>
        )}
        {record.status === "pending" && record.dispatch_state === "not_sent" && (
          <div className="ocr-preview" style={{ marginTop: 18 }}>
            <p className="form-note">
              Or place this call directly, without a KeeperHub payment first.
            </p>
            <button className="secondary" disabled={previewing} onClick={() => void loadPreview()}>
              {previewing ? <LoaderCircle size={14} className="spin" /> : <Phone size={14} />}
              Preview confirmation call
            </button>
            {preview && (
              <div style={{ marginTop: 14 }}>
                <pre>{preview.task || "No call script: this prescription needs staff review."}</pre>
                {preview.live_blockers.map((b) => (
                  <p className="form-note" key={b}>{b}</p>
                ))}
                <button
                  className="primary"
                  disabled={!!preview.live_blockers.length || !preview.task || !callsAvailable || busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Place one real call to ${record.phone_number}?\n\nThis dials a real phone and permanently spends one call from the local budget.`,
                      )
                    )
                      void directDispatch();
                  }}
                >
                  {busy ? <LoaderCircle size={14} className="spin" /> : <PhoneCall size={14} />}
                  Place one live call
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    );
  }

  function correctionSection() {
    if (!record || !["review", "fallback"].includes(record.status)) return null;
    return (
      <section className="panel detail-section reveal">
        <div className="section-title">
          <h2>Verify against the original prescription</h2>
        </div>
        <p className="form-note">Corrections are not applied automatically.</p>
        {!correction ? (
          <button className="secondary" onClick={startCorrection}>Review and correct</button>
        ) : (
          <form onSubmit={approve}>
            {correction.map((m, i) => (
              <div className="med-card" key={i}>
                <div className="form-grid">
                  <div className="field">
                    <label>Medicine name</label>
                    <input value={m.name} onChange={(e) => updateCorrectionMed(i, { name: e.target.value })} required />
                  </div>
                  <div className="field">
                    <label>Dose</label>
                    <input value={m.dosage} onChange={(e) => updateCorrectionMed(i, { dosage: e.target.value })} required />
                  </div>
                  <div className="field">
                    <label>Quantity</label>
                    <input value={m.quantity} onChange={(e) => updateCorrectionMed(i, { quantity: e.target.value })} required />
                  </div>
                  <div className="field">
                    <label>Timing (comma separated)</label>
                    <input
                      value={m.schedule.join(", ")}
                      onChange={(e) =>
                        updateCorrectionMed(i, {
                          schedule: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                        })
                      }
                      required
                    />
                  </div>
                  <div className="field">
                    <label>Duration</label>
                    <input value={m.duration} onChange={(e) => updateCorrectionMed(i, { duration: e.target.value })} required />
                  </div>
                  <div className="field">
                    <label>Instructions</label>
                    <input value={m.instructions} onChange={(e) => updateCorrectionMed(i, { instructions: e.target.value })} />
                  </div>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="add-med-button"
              onClick={() => setCorrection((prev) => (prev ? [...prev, emptyMed()] : prev))}
            >
              + Add medicine
            </button>
            <div className="field field-full" style={{ marginTop: 14 }}>
              <label>Verification notes</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} required />
            </div>
            <button className="primary full detail-action" disabled={approving}>
              {approving ? <LoaderCircle size={15} className="spin" /> : <CheckCheck size={15} />}
              Approve reviewed prescription
            </button>
          </form>
        )}
        {record.fallback_reason && (
          <p className="form-note" style={{ marginTop: 12 }}>
            {FALLBACK_REASONS[record.fallback_reason] || record.fallback_reason}
          </p>
        )}
      </section>
    );
  }

  function scheduleSection() {
    if (!record || !["confirmed", "scheduled"].includes(record.status)) return null;
    const meds = record.approved_medications || record.medications;
    return (
      <section className="panel detail-section reveal">
        <div className="section-title">
          <h2>Schedule a reminder</h2>
        </div>
        <form onSubmit={schedule}>
          <div className="form-grid">
            <div className="field">
              <label>Medicine</label>
              <select value={medName} onChange={(e) => setMedName(e.target.value)} required>
                <option value="">Choose a medicine</option>
                {meds.map((m) => (
                  <option key={m.name} value={m.name}>{m.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>
                Reminder time · {Intl.DateTimeFormat().resolvedOptions().timeZone}
              </label>
              <input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                required
              />
            </div>
          </div>
          <button className="primary detail-action" disabled={scheduling} style={{ marginTop: 14 }}>
            {scheduling ? <LoaderCircle size={15} className="spin" /> : <CheckCheck size={15} />}
            Save reminder
          </button>
        </form>
      </section>
    );
  }

  return (
    <DataGate>
      <Link className="back-link reveal" href="/confirmations">
        <ArrowLeft size={14} />
        All confirmations
      </Link>
      {record ? (
        <>
          <section className="panel detail-hero reveal">
            <div>
              <div className="eyebrow">PRESCRIPTION CONFIRMATION</div>
              <h2>{record.patient_name}</h2>
              <p>
                <Phone size={13} />
                {record.phone_number}
              </p>
            </div>
            <div className="detail-hero-meta">
              <Pill
                text={record.status}
                tone={record.status === "confirmed" ? "green" : "neutral"}
              />
              <span className="mono">{short(record.call_id)}</span>
              <span>
                Created {new Date(record.created_at).toLocaleString()}
              </span>
            </div>
          </section>
          <div className="detail-grid">
            <div>
              <section className="panel detail-section reveal">
                <h2>Prescription</h2>
                {record.medications.length ? (
                  record.medications.map((m, i) => (
                    <div className="medication" key={i}>
                      <div>
                        <b>{m.name}</b>
                        <span>{m.dosage}</span>
                      </div>
                      <p>
                        {[
                          m.quantity && `Quantity: ${m.quantity}`,
                          m.schedule?.join(", "),
                          m.duration,
                          m.instructions,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                  ))
                ) : (
                  <p>No medication details reported.</p>
                )}
              </section>
              {callSection()}
              {correctionSection()}
              {scheduleSection()}
            </div>
            {paymentInfo()}
          </div>
          {actionError && (
            <p role="alert" className="blocker reveal">
              {actionError}
            </p>
          )}
          {notice && (
            <p role="status" className="success-notice reveal">
              {notice}
            </p>
          )}
          {confirm && (
            <Modal
              title="Authorize payment and call"
              onClose={() => {
                if (!busy) setConfirm(false);
              }}
            >
              <span className="modal-symbol">
                <Wallet size={25} />
              </span>
              <h2>Authorize this call?</h2>
              <p>
                Pay <strong>{readiness?.amount_eth} ETH</strong> on Sepolia and
                call <strong>{record.phone_number}</strong>.
              </p>
              <div className="authorize-person">
                <b>{record.patient_name}</b>
                <span>{record.medications.map((m) => m.name).join(", ")}</span>
              </div>
              <p>
                This submits a real onchain transaction. Once payment is
                verified, CALL-E places a real phone call.
              </p>
              {!canPay && (
                <p role="alert" className="blocker">
                  The record or readiness has changed. Refresh and review before
                  proceeding.
                </p>
              )}
              <button
                className="primary full"
                disabled={busy || !canPay}
                onClick={() => void action("pay")}
              >
                {busy ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Wallet size={16} />
                )}
                Pay & call
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => setConfirm(false)}
              >
                Cancel
              </button>
            </Modal>
          )}
        </>
      ) : (
        <section className="panel reveal">
          <Empty
            title="Confirmation not found"
            text="This ID is not present in the backend’s current confirmation list."
          />
        </section>
      )}
    </DataGate>
  );
}
