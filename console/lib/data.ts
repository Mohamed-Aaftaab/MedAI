export type Confirmation = {
  call_id: string;
  patient_id: string;
  source_id: string;
  patient_name: string;
  phone_number: string;
  language: string;
  region: string;
  status: string;
  fallback_reason?: string | null;
  version: number;
  medications: Medication[];
  approved_medications?: Medication[];
  created_at: string;
  dispatch_state: string;
  provider_id?: string;
  structured_result?: {
    reached_patient?: string;
    overall?: string;
    patient_notes?: string;
    medications?: { name_as_read: string; status: string; correction_text?: string }[];
  };
  payment_state?: string | null;
  payment_execution_id?: string;
  payment_chain_id?: string;
  payment_recipient?: string;
  payment_amount?: string;
  payment_submitted_at?: string;
  payment_status?: string | null;
  payment_verified?: boolean;
  payment_receipt_status?: string;
  payment_tx_hash?: string;
  payment_block_number?: number;
  payment_gas_used?: string;
  payment_reconciled_at?: string;
};
export type Readiness = {
  configured_for_payment: boolean;
  configured_for_call: boolean;
  keeperhub_blockers: string[];
  call_blockers: string[];
  chain_id: string;
  amount_eth: string;
  note: string;
};
export type Medication = {
  name: string;
  dosage: string;
  quantity: string;
  schedule: string[];
  duration: string;
  instructions: string;
};
export type Patient = {
  patient_id: string;
  name: string;
  phone: string;
  language: string;
  region: string;
  consent: boolean;
  consent_evidence?: string;
  consent_withdrawn_at?: string | null;
  caregiver_name?: string | null;
  caregiver_phone?: string | null;
  caregiver_language?: string | null;
  caregiver_region?: string | null;
};
export type Job = {
  job_id: string;
  call_id: string;
  patient_id: string;
  kind: string;
  due_at: string;
  medication: { name: string } & Partial<Medication>;
  status: string;
  dispatch_state: string;
  provider_id?: string;
  structured_result?: Confirmation["structured_result"];
  patient_outcome?: string;
  patient_reason?: string;
};
export type Config = {
  calling: {
    enabled: boolean;
    working_limit: number;
    ceiling: number;
    reserved: number;
    allowed_phone_count: number;
    verified_locales: string[];
    callback_host: string | null;
    provider_host: string | null;
  };
  automation: {
    running: boolean;
    seen_at: string | null;
    age_seconds: number | null;
    mode: string | null;
  };
  storage: {
    tenant: string;
    database: string;
    scheduled_jobs: number;
    due_jobs: number;
  };
  auth: {
    named_staff_keys: boolean;
    legacy_demo_enabled: boolean;
  };
  blockers: string[];
};
export type OcrScanSummary = { scan_id: string; created_at?: string; pages: number };
export type OcrScan = {
  scan_id: string;
  engine: string;
  text: string;
  pages: unknown[];
  draft_medications: Medication[];
  created_at: string;
  sha256: string;
};
export function ethSum(records: Confirmation[]) {
  const wei = records
    .filter((r) => r.payment_verified)
    .reduce((sum, r) => {
      const value = r.payment_amount || "0";
      if (!/^\d+(\.\d{0,18})?$/.test(value)) return sum;
      const [whole, frac = ""] = value.split(".");
      return sum + BigInt(whole) * 10n ** 18n + BigInt(frac.padEnd(18, "0"));
    }, 0n);
  return (
    `${wei / 10n ** 18n}.${(wei % 10n ** 18n).toString().padStart(18, "0")}`.replace(
      /\.?0+$/,
      "",
    ) || "0"
  );
}
