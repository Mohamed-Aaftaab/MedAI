"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Confirmation, Readiness } from "@/lib/data";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function backend<T>(path: string, method = "GET"): Promise<T> {
  const response = await fetch(`/api/backend/${path}`, {
    method,
    cache: "no-store",
  });
  const body = await response
    .json()
    .catch(() => ({ detail: "The server returned an unreadable response." }));
  if (!response.ok)
    throw new ApiError(
      Array.isArray(body.detail)
        ? body.detail.join(" · ")
        : body.detail || "Request failed.",
      response.status,
    );
  return body;
}

function useWorkspaceState() {
  const [records, setRecords] = useState<Confirmation[]>([]);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [credential, setCredential] = useState(false);
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState<Date | null>(null);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState<string[]>([]);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const current = generation.current;
    setLoading(true);
    const task = (async () => {
      try {
        const [rows, ready] = await Promise.all([
          backend<Confirmation[]>("local/confirmations"),
          backend<Readiness>("campaigns/readiness"),
        ]);
        if (current !== generation.current) return false;
        if (!Array.isArray(rows))
          throw new Error(
            "The backend returned an invalid confirmations list.",
          );
        setRecords(rows);
        setReadiness(ready);
        setUpdated(new Date());
        setError("");
        return true;
      } catch (e) {
        if (current === generation.current) setError((e as Error).message);
        return false;
      } finally {
        if (current === generation.current) {
          setLoading(false);
          inFlight.current = null;
        }
      }
    })();
    inFlight.current = task;
    return task;
  }, []);
  useEffect(() => {
    let active = true;
    fetch("/api/session", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("Could not check your connection.");
        return r.json();
      })
      .then(async (s) => {
        if (!active) return;
        setCredential(s.connected);
        if (s.connected) await refresh();
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  useEffect(() => {
    if (!credential) return;
    const tick = () => {
      if (!document.hidden && !busy) void refresh();
    };
    const timer = setInterval(tick, 15000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [credential, busy, refresh]);
  useEffect(() => {
    try {
      setUncertain(
        JSON.parse(sessionStorage.getItem("medai:uncertain") || "[]"),
      );
    } catch {
      /* storage may be unavailable */
    }
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2500);
    return () => clearTimeout(timer);
  }, [toast]);
  async function login(token: string) {
    const r = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const body = await r.json();
    if (!r.ok)
      throw new Error(
        Array.isArray(body.detail)
          ? body.detail.join(" · ")
          : body.detail || "Connection failed.",
      );
    generation.current++;
    inFlight.current = null;
    setRecords([]);
    setReadiness(null);
    setUpdated(null);
    setError("");
    setCredential(true);
    await refresh();
  }
  async function logout() {
    const r = await fetch("/api/session", { method: "DELETE" });
    if (!r.ok) throw new Error("Could not disconnect. Try again.");
    generation.current++;
    inFlight.current = null;
    setRecords([]);
    setReadiness(null);
    setUpdated(null);
    setError("");
    setCredential(false);
    setLoading(false);
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setToast("Copied to clipboard");
    } catch {
      setToast("Clipboard unavailable");
    }
  }
  function markUncertain(id: string) {
    setUncertain((prev) => {
      const next = [...new Set([...prev, id])];
      try {
        sessionStorage.setItem("medai:uncertain", JSON.stringify(next));
      } catch {}
      return next;
    });
  }
  function updateRecord(record: Confirmation) {
    setRecords((prev) =>
      prev.map((r) => (r.call_id === record.call_id ? record : r)),
    );
  }
  return {
    records,
    readiness,
    credential,
    checking,
    loading,
    error,
    updated,
    toast,
    busy,
    setBusy,
    uncertain,
    markUncertain,
    refresh,
    login,
    logout,
    copy,
    updateRecord,
  };
}
type Workspace = ReturnType<typeof useWorkspaceState>;
const Context = createContext<Workspace | null>(null);
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  return (
    <Context.Provider value={useWorkspaceState()}>{children}</Context.Provider>
  );
}
export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error("WorkspaceProvider is required.");
  return value;
}
