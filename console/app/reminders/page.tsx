"use client";
import { useCallback, useEffect, useState } from "react";
import { AlarmClock, LoaderCircle, PhoneCall } from "lucide-react";
import { ApiError, backend, useWorkspace } from "@/components/workspace";
import { DataGate, Empty, Pill } from "@/components/ui";
import type { Job, Patient } from "@/lib/data";

export default function Reminders() {
  const { readiness, credential, updated } = useWorkspace();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [j, p] = await Promise.all([
        backend<Job[]>("local/jobs"),
        backend<Patient[]>("local/patients"),
      ]);
      setJobs(j);
      setPatients(p);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!credential || !updated) return;
    void load();
  }, [credential, updated, load]);

  async function dispatch(job: Job) {
    setBusyId(job.job_id);
    setNotice("");
    try {
      await backend(`local/jobs/${encodeURIComponent(job.job_id)}/dispatch`, "POST", {});
      await load();
      setNotice(
        "Reminder call submitted to the provider. An accepted request is not proof the phone connected.",
      );
    } catch (e) {
      const err = e as ApiError;
      await load();
      if (!(err instanceof ApiError) || err.status !== 502) setError(err.message);
      else setNotice(err.message);
    } finally {
      setBusyId("");
    }
  }

  const callsAvailable = !!readiness?.configured_for_call;

  return (
    <DataGate>
      {error && (
        <p className="blocker" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success-notice" role="status">
          {notice}
        </p>
      )}
      <section className="panel detail-section reveal">
        <div className="section-title">
          <h2>
            <AlarmClock size={16} /> Scheduled reminders
          </h2>
        </div>
        {loading ? (
          <p className="worker-loading">
            <LoaderCircle className="spin" size={15} />
            Loading reminders…
          </p>
        ) : jobs.length ? (
          jobs.map((j) => {
            const patient = patients.find((p) => p.patient_id === j.patient_id);
            const due = new Date(j.due_at) <= new Date();
            const pending = j.status === "pending" && j.dispatch_state === "not_sent";
            return (
              <div className="reminder-card" key={j.job_id}>
                <div>
                  <h3>{patient?.name || j.patient_id}</h3>
                  <p>
                    {(j.kind === "escalation" ? "Caregiver escalation · " : "") +
                      (j.medication?.name || "Reminder")}{" "}
                    · Due {new Date(j.due_at).toLocaleString()}
                  </p>
                </div>
                <Pill
                  text={j.status}
                  tone={j.status === "completed" ? "green" : j.status === "review" ? "amber" : "neutral"}
                />
                {pending ? (
                  <button
                    className="primary"
                    disabled={!due || !callsAvailable || busyId === j.job_id}
                    title={
                      !due
                        ? "Not due yet"
                        : !callsAvailable
                          ? "Calling is not configured. See System readiness."
                          : undefined
                    }
                    onClick={() => {
                      if (
                        confirm(
                          `Place one real reminder call to ${patient?.phone || "the recipient"} now?\n\nThis dials a real phone and permanently spends one call from the local budget.`,
                        )
                      )
                        void dispatch(j);
                    }}
                  >
                    {busyId === j.job_id ? (
                      <LoaderCircle size={14} className="spin" />
                    ) : (
                      <PhoneCall size={14} />
                    )}
                    {due ? "Place reminder call" : "Not due yet"}
                  </button>
                ) : (
                  <span className="quiet-text">
                    {j.dispatch_state !== "not_sent" ? "Already dispatched" : ""}
                  </span>
                )}
              </div>
            );
          })
        ) : (
          <Empty
            title="No reminders scheduled"
            text="A reminder is created from an approved prescription: open a confirmed one, pick a medicine and a time. Reminders are dialled one at a time, by hand, from this view — or automatically by worker.py --live once enabled."
          />
        )}
      </section>
    </DataGate>
  );
}
