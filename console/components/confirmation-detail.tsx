"use client";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCheck,
  LoaderCircle,
  Phone,
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
import type { Confirmation } from "@/lib/data";

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
              <section className="panel detail-section reveal">
                <div className="section-title">
                  <h2>Call outcome</h2>
                  <Pill text={callLabel(record)} />
                </div>
                {record.structured_result ? (
                  <div className="outcome">
                    <CheckCheck size={20} />
                    <div>
                      <b>
                        {record.structured_result.overall || "Result received"}
                      </b>
                      <p>
                        Reached patient:{" "}
                        {record.structured_result.reached_patient ||
                          "Not reported"}
                      </p>
                      {record.structured_result.patient_notes && (
                        <p>{record.structured_result.patient_notes}</p>
                      )}
                      {!!record.structured_result.medications?.length && (
                        <details>
                          <summary>Medication responses</summary>
                          <pre>
                            {JSON.stringify(
                              record.structured_result.medications,
                              null,
                              2,
                            )}
                          </pre>
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
                    <button
                      className="mono"
                      title="Copy provider ID"
                      onClick={() => copy(record.provider_id!)}
                    >
                      {record.provider_id}
                    </button>
                  </div>
                )}
              </section>
            </div>
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
                  <span>
                    {record.payment_state ? "Amount" : "Configured amount"}
                  </span>
                  <Amount
                    value={record.payment_amount || readiness?.amount_eth}
                  />
                </div>
                <div>
                  <span>Network</span>
                  <span>
                    {(record.payment_chain_id || readiness?.chain_id) ===
                    "11155111"
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
                {[
                  ["Execution", record.payment_execution_id],
                  ["Recipient", record.payment_recipient],
                  ["Block", record.payment_block_number],
                  ["Gas used", record.payment_gas_used],
                  ["Receipt", record.payment_receipt_status],
                  ["Submitted", record.payment_submitted_at],
                  ["Reconciled", record.payment_reconciled_at],
                ].map(
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
              {actionError && (
                <p role="alert" className="blocker">
                  {actionError}
                </p>
              )}
              {notice && (
                <p role="status" className="success-notice">
                  {notice}
                </p>
              )}
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
                      dispatch.{" "}
                      <Link href="/system">Inspect system readiness.</Link>
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
          </div>
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
