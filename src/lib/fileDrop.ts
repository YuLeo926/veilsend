export type DropKind = "image" | "pdf";

const allowed = { image: [".jpg", ".jpeg", ".png"], pdf: [".pdf"] } as const;

export function classifyFileDrop(paths: string[], kind: DropKind, busy: boolean):
  | { ok: true; path: string }
  | { ok: false; message: string } {
  if (busy) return { ok: false, message: "Wait for the current operation to finish." };
  if (paths.length !== 1) return { ok: false, message: "Drop exactly one supported file." };
  const path = paths[0];
  if (!allowed[kind].some((extension) => path.toLowerCase().endsWith(extension))) {
    return { ok: false, message: kind === "image" ? "Drop one JPEG or PNG image." : "Drop one PDF document." };
  }
  return { ok: true, path };
}

export function dropPrompt(kind: DropKind, busy: boolean): string {
  if (busy) return kind === "image" ? "Wait for the current image operation" : "Wait for the current PDF operation";
  return kind === "image" ? "Choose, paste, or drop one JPEG/PNG" : "Choose or drop one PDF";
}
