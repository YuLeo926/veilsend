import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, LockKeyhole, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { openProjectLink, type ProjectLink } from "../lib/projectLinks";
import type { RuntimeInfo } from "../lib/types";

export type TrustRuntimeState = "loading" | "loaded" | "failed";

interface TrustCenterProps {
  open: boolean;
  onClose: () => void;
  runtimeInfo: RuntimeInfo | null;
  runtimeState: TrustRuntimeState;
  busy?: boolean;
}

const detectorLabels: Array<[keyof RuntimeInfo["detectors"], string]> = [
  ["text", "Text rules"],
  ["metadata", "Metadata"],
  ["face", "Face detection"],
  ["qr", "QR codes"],
  ["barcode", "Barcodes"],
  ["pdf", "PDF review"],
];

export function TrustCenter({ open, onClose, runtimeInfo, runtimeState, busy = false }: TrustCenterProps) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const [linkError, setLinkError] = useState("");

  useEffect(() => {
    if (!open) return;

    const focusClose = window.setTimeout(() => closeButton.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = dialog.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusClose);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [busy, onClose, open]);

  useEffect(() => {
    if (open) setLinkError("");
  }, [open]);

  if (!open) return null;

  const identityLabel = runtimeState === "loading"
    ? "Loading build identity"
    : runtimeInfo?.verifiedBuild
      ? "Official build identity"
      : "Unverified build";

  async function openLink(kind: ProjectLink) {
    setLinkError("");
    try {
      await openProjectLink(kind);
    } catch {
      setLinkError("Could not open that link. Check your system browser and try again.");
    }
  }

  function requestClose() {
    if (!busy) onClose();
  }

  return (
    <div className="trust-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <div
        ref={dialog}
        className="trust-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trust-center-title"
        aria-describedby="trust-center-boundary"
      >
        <header className="trust-center-header">
          <div>
            <span className="trust-kicker">Local trust center</span>
            <h2 id="trust-center-title">Build identity &amp; local boundaries</h2>
          </div>
          <button ref={closeButton} className="trust-close" type="button" onClick={requestClose} disabled={busy} aria-label="Close trust center">
            <X size={18} />
          </button>
        </header>

        <div className={`trust-identity ${runtimeInfo?.verifiedBuild ? "verified" : "unverified"}`}>
          {runtimeInfo?.verifiedBuild ? <ShieldCheck size={23} /> : <ShieldAlert size={23} />}
          <div>
            <strong>{identityLabel}</strong>
            <span>{runtimeInfo?.verifiedBuild ? "Release identity was supplied by the build pipeline." : "This build cannot be confirmed as an official beta release."}</span>
          </div>
        </div>

        {runtimeState === "loading" ? (
          <p className="trust-pending">Reading the local build record…</p>
        ) : runtimeInfo ? (
          <dl className="trust-facts">
            <div><dt>Version</dt><dd>{runtimeInfo.appVersion}</dd></div>
            <div><dt>Channel</dt><dd>{runtimeInfo.channel}</dd></div>
            <div><dt>Commit</dt><dd className="trust-mono">{runtimeInfo.commit}</dd></div>
            <div><dt>Build target</dt><dd>{runtimeInfo.target}</dd></div>
            <div><dt>Operating system</dt><dd>{runtimeInfo.osVersion}</dd></div>
            <div><dt>License</dt><dd>{runtimeInfo.license}</dd></div>
          </dl>
        ) : (
          <p className="trust-pending">The build identity was unavailable. Your local scanning and cleaning workflow remains available.</p>
        )}

        <section className="trust-boundary" aria-labelledby="trust-boundary-title">
          <LockKeyhole size={18} />
          <div>
            <h3 id="trust-boundary-title">Local processing boundary</h3>
            <p id="trust-center-boundary">VeilSend does not upload your files. Scanning, review, cleaning, verification, and saving happen on this device. Project pages open only when you choose one below.</p>
          </div>
        </section>

        <section className="trust-capabilities" aria-labelledby="capability-title">
          <div className="trust-section-heading">
            <div><span>Current device</span><h3 id="capability-title">Detector capability</h3></div>
            <small>Availability only — no detected content is retained here.</small>
          </div>
          <div className="trust-capability-grid">
            {detectorLabels.map(([key, label]) => {
              const available = runtimeInfo?.detectors[key] === "available";
              return <div className={available ? "available" : "unavailable"} key={key}>
                {available ? <Check size={14} /> : <X size={14} />}
                <span>{label}</span>
                <b>{available ? "Available" : "Unavailable"}</b>
              </div>;
            })}
          </div>
        </section>

        <section className="trust-links" aria-label="VeilSend project links">
          <span>Open only on your action</span>
          <div>
            <button type="button" onClick={() => void openLink("releases")}>Releases <ExternalLink size={14} /></button>
            <button type="button" onClick={() => void openLink("source")}>Source code <ExternalLink size={14} /></button>
            <button type="button" onClick={() => void openLink("security")}>Security reporting <ExternalLink size={14} /></button>
          </div>
          {linkError && <p className="trust-link-error" role="status">{linkError}</p>}
        </section>
      </div>
    </div>
  );
}
