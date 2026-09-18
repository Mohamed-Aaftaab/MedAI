"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCheck,
  Download,
  FileScan,
  LoaderCircle,
  Plus,
  ScanText,
  Trash2,
  UserRound,
} from "lucide-react";
import { backend, backendFile, useWorkspace } from "@/components/workspace";
import { DataGate } from "@/components/ui";
import type { Medication, OcrScan, OcrScanSummary, Patient } from "@/lib/data";

const emptyMed = (): Medication => ({
  name: "",
  dosage: "",
  quantity: "",
  schedule: [],
  duration: "",
  instructions: "",
});

export default function Intake() {
  const router = useRouter();
  const { refresh, updateRecord, records, credential, updated } = useWorkspace();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [scans, setScans] = useState<OcrScanSummary[]>([]);
  const [loadError, setLoadError] = useState("");
  const [patientId, setPatientId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [language, setLanguage] = useState("en-IN");
  const [region, setRegion] = useState("IN");
  const [consent, setConsent] = useState(false);
  const [evidence, setEvidence] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [meds, setMeds] = useState<Medication[]>([emptyMed()]);
  const [scan, setScan] = useState<OcrScan | null>(null);
  const [ocrChecked, setOcrChecked] = useState(false);
  const [selectedScan, setSelectedScan] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [formError, setFormError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!credential || !updated) return;
    void (async () => {
      try {
        const [p, s] = await Promise.all([
          backend<Patient[]>("local/patients"),
          backend<OcrScanSummary[]>("local/ocr"),
        ]);
        setPatients(p);
        setScans(s);
      } catch (e) {
        setLoadError((e as Error).message);
      }
    })();
  }, [credential, updated]);

  function selectPatient(id: string) {
    setPatientId(id);
    const p = patients.find((x) => x.patient_id === id);
    setName(p?.name || "");
    setPhone(p?.phone || "");
    setLanguage(p?.language || "en-IN");
    setRegion(p?.region || "IN");
    setConsent(Boolean(p?.consent && !p?.consent_withdrawn_at));
    setEvidence(p?.consent_evidence || "");
  }

  function clearOcr() {
    setScan(null);
    setOcrChecked(false);
    if (sourceId.startsWith("ocr-")) setSourceId("");
  }

  async function extract() {
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setFormError("Choose a prescription file first.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setFormError("Maximum upload size is 10 MB.");
      return;
    }
    setExtracting(true);
    setFormError("");
    setNotice("Reading the prescription locally…");
    try {
      const bytes = await file.arrayBuffer();
      const result = await backend<OcrScan>(
        "local/ocr/extract",
        "POST",
        undefined,
        { body: bytes, contentType: "application/octet-stream" },
      );
      setScan(result);
      setSourceId(result.scan_id);
      setOcrChecked(false);
      setScans(await backend<OcrScanSummary[]>("local/ocr"));
      setNotice(
        "Scan saved. Use suggested fields, then verify against the original and fill missing details.",
      );
    } catch (e) {
      setFormError((e as Error).message);
      setNotice("");
    } finally {
      setExtracting(false);
    }
  }

  async function reopenScan() {
    if (!selectedScan) {
      setFormError("Choose a saved scan first.");
      return;
    }
    try {
      const result = await backend<OcrScan>(
        `local/ocr/${encodeURIComponent(selectedScan)}`,
      );
      setScan(result);
      setSourceId(result.scan_id);
      setOcrChecked(false);
      setNotice("Saved scan loaded. Review the source before saving.");
    } catch (e) {
      setFormError((e as Error).message);
    }
  }

  function useDraft() {
    if (!scan?.draft_medications.length) return;
    setMeds(scan.draft_medications.map((m) => ({ ...m })));
    setOcrChecked(false);
    setNotice(
      "Suggestions loaded. Blank fields were not present in the source. Verify all values before saving.",
    );
  }

  async function downloadSource() {
    if (!scan) return;
    try {
      const blob = await backendFile(
        `local/ocr/${encodeURIComponent(scan.scan_id)}/source`,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "prescription-source";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      setFormError((e as Error).message);
    }
  }

  function updateMed(i: number, patch: Partial<Medication>) {
    setMeds((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError("");
    setNotice("");
    try {
      if (!meds.length) throw new Error("Add at least one medicine.");
      for (const m of meds) {
        if (!m.name.trim() || !m.dosage.trim() || !m.quantity.trim() || !m.duration.trim())
          throw new Error("Complete each required medicine field.");
        if (!m.schedule.length) throw new Error("Complete each required medicine field.");
      }
      if (!sourceId.trim()) throw new Error("Prescription reference is required.");
      const id = patientId || crypto.randomUUID();
      const original = patients.find((p) => p.patient_id === id);
      await backend("local/patients", "PUT", {
        patient_id: id,
        name: name.trim(),
        phone: phone.trim(),
        language,
        region,
        consent,
        consent_evidence: evidence.trim(),
        caregiver_name: original?.caregiver_name ?? null,
        caregiver_phone: original?.caregiver_phone ?? null,
        caregiver_language: original?.caregiver_language ?? null,
        caregiver_region: original?.caregiver_region ?? null,
      });
      const record = await backend(`local/intakes`, "POST", {
        patient_id: id,
        source_id: sourceId.trim(),
        medications: meds.map((m) => ({
          name: m.name.trim(),
          dosage: m.dosage.trim(),
          quantity: m.quantity.trim(),
          schedule: m.schedule,
          duration: m.duration.trim(),
          instructions: m.instructions.trim(),
        })),
        ocr_reviewed: !!scan && ocrChecked,
      });
      updateRecord(record as never);
      await refresh();
      setNotice("Prescription saved. No call has been placed.");
      router.push("/confirmations");
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <DataGate>
    <div className="intake-page">
      {loadError && (
        <p className="blocker" role="alert">
          {loadError}
        </p>
      )}
      <form onSubmit={submit}>
        <section className="panel detail-section reveal">
          <div className="section-title">
            <h2>
              <UserRound size={16} /> Patient details
            </h2>
          </div>
          <div className="form-grid">
            <div className="field field-full">
              <label>Patient</label>
              <select
                value={patientId}
                onChange={(e) => selectPatient(e.target.value)}
              >
                <option value="">Add a new patient</option>
                {patients.map((p) => (
                  <option key={p.patient_id} value={p.patient_id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Full name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                required
              />
            </div>
            <div className="field">
              <label>Phone number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91…"
                pattern="\+[1-9][0-9]{7,14}"
                required
              />
            </div>
            <div className="field">
              <label>Preferred language</label>
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="en-IN">English (India)</option>
                <option value="hi-IN">Hindi</option>
                <option value="ta-IN">Tamil</option>
                <option value="te-IN">Telugu</option>
                <option value="en-US">English (US)</option>
              </select>
            </div>
            <div className="field">
              <label>Calling region</label>
              <select value={region} onChange={(e) => setRegion(e.target.value)}>
                <option value="IN">India</option>
                <option value="US">United States</option>
              </select>
            </div>
            <div className="field field-full">
              <label>Consent record</label>
              <input
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                placeholder="When and how the patient agreed to calls"
                maxLength={1000}
                required
              />
            </div>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              required
            />
            The patient agreed to prescription confirmation and reminder
            calls. Consent has not been withdrawn.
          </label>
        </section>

        <section className="panel detail-section reveal">
          <div className="section-title">
            <h2>
              <ScanText size={16} /> Scan a prescription
            </h2>
          </div>
          <p className="form-note">
            Local OCR · PNG, JPEG, WebP or PDF · up to 10 MB. Verify every
            medicine against the original; handwriting may not be recognized
            correctly.
          </p>
          <div className="form-grid">
            <div className="field">
              <label>Saved scans</label>
              <select
                value={selectedScan}
                onChange={(e) => setSelectedScan(e.target.value)}
              >
                <option value="">Choose a saved scan</option>
                {scans.map((s) => (
                  <option key={s.scan_id} value={s.scan_id}>
                    {(s.created_at ? new Date(s.created_at).toLocaleString() : s.scan_id) +
                      ` · ${s.pages} page(s)`}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ alignSelf: "flex-end" }}>
              <button
                type="button"
                className="secondary full"
                onClick={() => void reopenScan()}
              >
                Reopen scan
              </button>
            </div>
          </div>
          <div className="upload-row">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              onChange={clearOcr}
            />
            <button
              type="button"
              className="secondary"
              disabled={extracting}
              onClick={() => void extract()}
            >
              {extracting ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <FileScan size={14} />
              )}
              Extract text locally
            </button>
          </div>
          {scan && (
            <div className="ocr-preview">
              <p className="form-note">
                Unverified OCR text — suggested fields are transcribed from
                this scan. Check every value against the original and fill
                any blanks.
              </p>
              <div className="upload-row">
                <button type="button" className="secondary" onClick={() => void downloadSource()}>
                  <Download size={13} /> Download original prescription
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={!scan.draft_medications.length}
                  onClick={useDraft}
                >
                  <CheckCheck size={13} /> Use suggested medicine fields
                </button>
              </div>
              <pre>{scan.text}</pre>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={ocrChecked}
                  onChange={(e) => setOcrChecked(e.target.checked)}
                />
                I checked the entered medicine details against the original
                prescription.
              </label>
            </div>
          )}
        </section>

        <section className="panel detail-section reveal">
          <div className="section-title">
            <h2>Prescription details</h2>
          </div>
          <p className="form-note">
            Enter the prescribed details exactly as written. Do not infer an
            unclear dose.
          </p>
          <div className="field field-full" style={{ marginTop: 14 }}>
            <label>Prescription reference</label>
            <input
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              placeholder="Clinic prescription or scan reference"
              readOnly={!!scan}
              maxLength={200}
              required
            />
          </div>
          {meds.map((m, i) => (
            <div className="med-card" key={i}>
              <div className="med-card-head">
                <h3>Medicine</h3>
                {meds.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setMeds((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 size={13} /> Remove
                  </button>
                )}
              </div>
              <div className="form-grid">
                <div className="field">
                  <label>Medicine name</label>
                  <input
                    value={m.name}
                    onChange={(e) => updateMed(i, { name: e.target.value })}
                    maxLength={200}
                    required
                  />
                </div>
                <div className="field">
                  <label>Dose</label>
                  <input
                    value={m.dosage}
                    onChange={(e) => updateMed(i, { dosage: e.target.value })}
                    maxLength={100}
                    required
                  />
                </div>
                <div className="field">
                  <label>Quantity</label>
                  <input
                    value={m.quantity}
                    onChange={(e) => updateMed(i, { quantity: e.target.value })}
                    maxLength={100}
                    required
                  />
                </div>
                <div className="field">
                  <label>Timing (comma separated)</label>
                  <input
                    value={m.schedule.join(", ")}
                    onChange={(e) =>
                      updateMed(i, {
                        schedule: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    required
                  />
                </div>
                <div className="field">
                  <label>Duration</label>
                  <input
                    value={m.duration}
                    onChange={(e) => updateMed(i, { duration: e.target.value })}
                    maxLength={100}
                    required
                  />
                </div>
                <div className="field">
                  <label>Instructions</label>
                  <input
                    value={m.instructions}
                    onChange={(e) => updateMed(i, { instructions: e.target.value })}
                    maxLength={500}
                  />
                </div>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="add-med-button"
            onClick={() => setMeds((prev) => [...prev, emptyMed()])}
          >
            <Plus size={13} /> Add medicine
          </button>
        </section>

        {formError && (
          <p className="blocker" role="alert">
            {formError}
          </p>
        )}
        {notice && (
          <p className="success-notice" role="status">
            {notice}
          </p>
        )}
        <div className="intake-actions reveal">
          <button className="primary" disabled={saving}>
            {saving ? <LoaderCircle size={15} className="spin" /> : <CheckCheck size={15} />}
            Save for confirmation
          </button>
          <span className="form-note">No call will be placed.</span>
        </div>
      </form>
      <p className="quiet-text">
        {records.length} confirmation{records.length === 1 ? "" : "s"} already in this
        workspace.
      </p>
    </div>
    </DataGate>
  );
}
