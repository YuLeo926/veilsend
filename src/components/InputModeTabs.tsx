import { FileStack, FileText, Image as ImageIcon } from "lucide-react";

export type InputMode = "text" | "image" | "pdf";

export function InputModeTabs({
  active,
  onChange,
  disabled = false,
}: {
  active: InputMode;
  onChange: (mode: InputMode) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mode-tabs" aria-label="Content type">
      <button
        type="button"
        className={active === "text" ? "active" : ""}
        aria-pressed={active === "text"}
        disabled={disabled}
        onClick={() => !disabled && onChange("text")}
      >
        <FileText size={16} /> Text & logs
      </button>
      <button
        type="button"
        className={active === "image" ? "active" : ""}
        aria-pressed={active === "image"}
        disabled={disabled}
        onClick={() => !disabled && onChange("image")}
      >
        <ImageIcon size={16} /> Images
        <span>NEW</span>
      </button>
      <button
        type="button"
        className={active === "pdf" ? "active" : ""}
        aria-pressed={active === "pdf"}
        disabled={disabled}
        onClick={() => !disabled && onChange("pdf")}
      >
        <FileStack size={16} /> PDF
        <span>NEW</span>
      </button>
    </div>
  );
}
