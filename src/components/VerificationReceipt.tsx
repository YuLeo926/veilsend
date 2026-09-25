import { useEffect, useId, useState } from "react";
import { Check, Copy, Fingerprint, LoaderCircle } from "lucide-react";
import { formatVerificationReceipt, type VerificationReceiptData } from "../lib/verificationReceipt";

export function VerificationReceipt({ data }: { data: VerificationReceiptData }) {
  const checkboxId = useId();
  const [includeFingerprint, setIncludeFingerprint] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "failed">("idle");

  useEffect(() => {
    setIncludeFingerprint(false);
    setCopyState("idle");
  }, [data.outputFingerprint]);

  async function copyReceipt() {
    if (copyState === "copying") return;
    setCopyState("copying");
    try {
      await navigator.clipboard.writeText(formatVerificationReceipt(data, includeFingerprint));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <aside className="verification-receipt" aria-labelledby={`${checkboxId}-title`}>
      <div className="verification-receipt-heading">
        <span className="verification-receipt-mark" aria-hidden="true"><Fingerprint size={18} /></span>
        <div>
          <strong id={`${checkboxId}-title`}>Private verification receipt</strong>
          <span>Copies bounded verification facts only—never paths, filenames, or source content.</span>
        </div>
      </div>
      <label className="receipt-fingerprint-option" htmlFor={checkboxId}>
        <input
          id={checkboxId}
          type="checkbox"
          checked={includeFingerprint}
          onChange={(event) => {
            setIncludeFingerprint(event.target.checked);
            setCopyState("idle");
          }}
        />
        <span>
          <strong>Include output SHA-256</strong>
          <small>Optional. A stable fingerprint can correlate this saved file across separate shares.</small>
        </span>
      </label>
      <div className="verification-receipt-actions">
        <button
          className="secondary-button receipt-copy-button"
          type="button"
          disabled={copyState === "copying"}
          onClick={() => void copyReceipt()}
        >
          {copyState === "copying" ? <LoaderCircle className="spin" size={16} /> : copyState === "copied" ? <Check size={16} /> : <Copy size={16} />}
          {copyState === "copying" ? "Copying…" : copyState === "copied" ? "Receipt copied" : "Copy verification receipt"}
        </button>
        <span className={copyState === "failed" ? "receipt-copy-status error" : "receipt-copy-status"} aria-live="polite">
          {copyState === "failed" ? "Copy failed. Nothing was saved or uploaded." : includeFingerprint ? "SHA-256 will be included on click." : "SHA-256 stays excluded."}
        </span>
      </div>
    </aside>
  );
}
