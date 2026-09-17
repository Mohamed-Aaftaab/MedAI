"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  AudioLines,
  BellRing,
  Check,
  CheckCheck,
  ChevronRight,
  Fingerprint,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Radio,
  RefreshCw,
  ScanText,
  Settings2,
  Wallet,
  X,
} from "lucide-react";
import { useWorkspace, WorkspaceProvider } from "./workspace";

const routes = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/confirmations", label: "Confirmations", icon: CheckCheck },
  { href: "/intake", label: "New prescription", icon: ScanText },
  { href: "/reminders", label: "Reminders", icon: BellRing },
  { href: "/payments", label: "Payments", icon: Wallet },
  { href: "/calls", label: "Call activity", icon: AudioLines },
  { href: "/system", label: "System", icon: Settings2 },
];
const HEADINGS: Record<string, { title: string; subtitle: string }> = {
  Overview: {
    title: "Every call. Accounted for.",
    subtitle: "A live view of your payment-to-call workflow.",
  },
  Confirmations: {
    title: "Prescription confirmations",
    subtitle: "Review prescriptions and authorize paid confirmation calls.",
  },
  "New prescription": {
    title: "Add a prescription.",
    subtitle: "Scan, review, and save — no call is placed until you authorize one.",
  },
  Reminders: {
    title: "Nothing is dialled automatically.",
    subtitle: "Scheduled adherence and escalation calls, dispatched one at a time.",
  },
  Payments: {
    title: "Every payment has a receipt.",
    subtitle: "Trace each transfer from submission to onchain verification.",
  },
  "Call activity": {
    title: "Conversations that count.",
    subtitle: "Dispatch status and patient outcomes, directly from MedAI.",
  },
  System: {
    title: "Ready for the next call.",
    subtitle: "Payment configuration, voice readiness, and the execution flow.",
  },
};
export function Modal({
  children,
  title,
  onClose,
}: {
  children: React.ReactNode;
  title: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <button
        className="icon-button close"
        aria-label="Close dialog"
        onClick={onClose}
      >
        <X size={18} />
      </button>
      {children}
    </dialog>
  );
}
function Brand() {
  return (
    <>
      <span className="brand-icon">
        <AudioLines size={23} />
      </span>
      <span className="brand-word">
        MedAI<span className="brand-dot">.</span>
      </span>
    </>
  );
}
function ConsoleShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const {
    records,
    readiness,
    credential,
    checking,
    loading,
    error,
    updated,
    refresh,
    login,
    logout,
    toast,
    busy,
  } = useWorkspace();
  const [entered, setEntered] = useState(false);
  const [connect, setConnect] = useState(false),
    [token, setToken] = useState(""),
    [saving, setSaving] = useState(false),
    [formError, setFormError] = useState("");
  const dock = useRef<HTMLAnchorElement>(null),
    flying = useRef<HTMLDivElement>(null);
  const current =
    routes.find((r) => r.href !== "/" && path.startsWith(r.href)) || routes[0];
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setEntered(true);
      return;
    }
    const target = dock.current,
      logo = flying.current;
    if (!target || !logo) {
      setEntered(true);
      return;
    }
    const r = target.getBoundingClientRect();
    const logoWidth = logo.getBoundingClientRect().width;
    const targetScale = r.width / logoWidth;
    const startScale = Math.min(2.4, (innerWidth - 60) / logoWidth);
    const x = (innerWidth - logoWidth * startScale) / 2,
      y = (innerHeight - 40 * startScale) / 2;
    const initial = `translate3d(${x}px,${y}px,0) scale(${startScale})`;
    const animation = logo.animate(
      [
        { transform: initial, opacity: 0, filter: "blur(8px)", offset: 0 },
        { transform: initial, opacity: 1, filter: "blur(0px)", offset: 0.23 },
        { transform: initial, opacity: 1, filter: "blur(0px)", offset: 0.43 },
        {
          transform: `translate3d(${r.left}px,${r.top}px,0) scale(${targetScale})`,
          opacity: 1,
          filter: "blur(0px)",
          offset: 1,
        },
      ],
      { duration: 1850, easing: "cubic-bezier(.65,0,.25,1)", fill: "forwards" },
    );
    const finish = () => setEntered(true);
    animation.onfinish = finish;
    // Web Animations API onfinish can fail to fire (backgrounded tab, reduced
    // rendering priority, some automation contexts) which would otherwise
    // leave `main` permanently hidden behind the opening overlay.
    const fallback = window.setTimeout(finish, 2500);
    const onResize = () => {
      animation.cancel();
      finish();
    };
    window.addEventListener("resize", onResize, { once: true });
    return () => {
      animation.cancel();
      window.clearTimeout(fallback);
      window.removeEventListener("resize", onResize);
    };
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      await login(token);
      setToken("");
      setConnect(false);
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className={`shell ${entered ? "entered" : "booting"}`}>
      {!entered && (
        <div className="opening" aria-hidden="true">
          <div ref={flying} className="flying-brand">
            <Brand />
          </div>
        </div>
      )}
      <aside className="sidebar">
        <Link ref={dock} className="brand" href="/" aria-label="MedAI overview">
          <Brand />
        </Link>
        <div className="sidebar-content">
          <div className="workspace">
            <div className="workspace-mark">M</div>
            <div>
              MedAI workspace<small>Operator console</small>
            </div>
          </div>
          <div className="nav-label">WORKSPACE</div>
          <nav aria-label="Workspace navigation">
            {routes.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={`nav-item ${current.href === href ? "active" : ""}`}
                aria-current={current.href === href ? "page" : undefined}
                title={label}
              >
                <Icon size={18} />
                <span>{label}</span>
                {href === "/confirmations" && updated && (
                  <span className="nav-count">{records.length}</span>
                )}
              </Link>
            ))}
          </nav>
        </div>
        <div className="sidebar-bottom">
          <div className="network-card">
            <div>
              <span
                className={`live-dot ${!updated || error ? "muted" : ""}`}
              />
              {readiness?.chain_id === "11155111"
                ? "Sepolia testnet"
                : readiness
                  ? `Chain ${readiness.chain_id}`
                  : "Network not connected"}
            </div>
            <p>
              Payment verified.
              <br />
              Then the conversation.
            </p>
            {readiness && (
              <span className="chain-label">
                CHAIN ID <b>{readiness.chain_id}</b>
              </span>
            )}
          </div>
          <button className="profile" onClick={() => setConnect(true)}>
            <span className="avatar">OP</span>
            <span>
              Operator
              <small>
                {updated && !error
                  ? "Backend connected"
                  : "Connection settings"}
              </small>
            </span>
            <Settings2 size={16} />
          </button>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <div className="breadcrumbs">
            Workspace
            <ChevronRight size={13} />
            <span>{current.label}</span>
            {path.startsWith("/confirmations/") && (
              <>
                <ChevronRight size={13} />
                <span>Details</span>
              </>
            )}
          </div>
          <div className="top-actions">
            <span className="connection-state">
              <span
                className={`live-dot ${!updated || error ? "muted" : ""}`}
              />
              {checking
                ? "Checking connection"
                : error
                  ? "Connection issue"
                  : updated
                    ? "Backend connected"
                    : "Not connected"}
            </span>
            <button
              className="mode-button"
              onClick={() => setConnect(true)}
              aria-label="Connection settings"
            >
              <Settings2 size={15} />
            </button>
          </div>
        </header>
        <main
          key={path}
          className={`route-content route-${current.href === "/" ? "overview" : current.href.slice(1)}`}
        >
          <div className="page-heading reveal">
            <div>
              <div className="eyebrow">
                <span />
                MEDAI / {current.label.toUpperCase()}
              </div>
              <h1>
                {path.startsWith("/confirmations/")
                  ? "Confirmation details"
                  : HEADINGS[current.label].title}
              </h1>
              <p>
                {path.startsWith("/confirmations/")
                  ? "Patient, prescription, payment authorization, and call outcome."
                  : HEADINGS[current.label].subtitle}
              </p>
            </div>
            <button
              className="primary"
              aria-label={credential ? "Refresh data" : "Connect backend"}
              disabled={loading || busy || checking}
              onClick={() => (credential ? void refresh() : setConnect(true))}
            >
              {credential ? (
                <RefreshCw size={16} className={loading ? "spin" : ""} />
              ) : (
                <Link2 size={16} />
              )}
              <span>{credential ? "Refresh data" : "Connect backend"}</span>
              <ArrowUpRight size={15} />
            </button>
          </div>
          {error && (
            <div className="error-banner reveal" role="alert">
              <span>
                {error}
                {updated && " Displaying the last successful sync."}
              </span>
              <button onClick={() => setConnect(true)}>
                Connection settings
              </button>
            </div>
          )}
          {updated && (
            <div className="sync-line reveal">
              <Radio size={12} />
              Last synced {updated.toLocaleTimeString()}
              <span>Auto-refresh · 15 seconds</span>
            </div>
          )}
          {children}
          <footer className="page-footer reveal">
            <span>
              <AudioLines size={13} />
              MedAI · Payment before execution
            </span>
            <span>KeeperHub Agent Economy</span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
        </div>
      )}
      {connect && (
        <Modal
          title="Connect MedAI backend"
          onClose={() => {
            if (!saving) setConnect(false);
          }}
        >
          <span className="modal-symbol">
            <Fingerprint size={27} />
          </span>
          <div className="eyebrow">OPERATOR CONNECTION</div>
          <h2>Connect to MedAI.</h2>
          <p>
            Enter your staff token. Your dashboard will load directly from the
            configured MedAI backend.
          </p>
          <form onSubmit={submit}>
            <label htmlFor="token" className="field-label">
              Staff token
            </label>
            <input
              id="token"
              className="token-input"
              type="password"
              autoComplete="off"
              placeholder="Enter your operator token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
            <p className="form-note">
              <LockKeyhole size={12} />
              Stored in an HTTP-only session cookie.
            </p>
            {formError && (
              <p className="blocker" role="alert">
                {formError}
              </p>
            )}
            <button className="primary full" disabled={saving}>
              {saving ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Link2 size={15} />
              )}
              Connect workspace
            </button>
          </form>
          {credential && (
            <button
              className="text-button"
              disabled={saving || busy}
              onClick={async () => {
                setSaving(true);
                try {
                  await logout();
                  setConnect(false);
                } catch (e) {
                  setFormError((e as Error).message);
                } finally {
                  setSaving(false);
                }
              }}
            >
              <LogOut size={14} />
              Disconnect workspace
            </button>
          )}
        </Modal>
      )}
    </div>
  );
}
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <ConsoleShell>{children}</ConsoleShell>
    </WorkspaceProvider>
  );
}
