export type Confirmation = {
  call_id: string;
  patient_name: string;
  phone_number: string;
  status: string;
  medications: {
    name: string;
    dosage: string;
    quantity?: string;
    schedule?: string[];
    duration?: string;
    instructions?: string;
  }[];
  created_at: string;
  dispatch_state: string;
  provider_id?: string;
  structured_result?: {
    reached_patient?: string;
    overall?: string;
    patient_notes?: string;
    medications?: unknown[];
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
