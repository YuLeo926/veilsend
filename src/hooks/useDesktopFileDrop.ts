import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useRef } from "react";
import { isDesktop } from "../lib/bridge";
import { classifyFileDrop, type DropKind } from "../lib/fileDrop";

type DesktopFileDropOptions = {
  enabled: boolean;
  kind: DropKind;
  busy: boolean;
  onDrop: (path: string) => void | Promise<void>;
  onActive: (active: boolean) => void;
  onError: (message: string) => void;
};

export function useDesktopFileDrop(options: DesktopFileDropOptions): void {
  const latest = useRef(options);
  latest.current = options;
  const registration = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!options.enabled || !isDesktop()) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;
    // Wait for any prior pending registration to resolve and be disposed first.
    const setup = registration.current.then(async () => {
      if (disposed) return;
      try {
        const stop = await getCurrentWebview().onDragDropEvent((event) => {
          if (disposed || !latest.current.enabled) return;
          const current = latest.current;
          const payload = event.payload;
          if (payload.type === "enter" || payload.type === "over") {
            current.onActive(true);
            return;
          }
          if (payload.type === "leave") {
            current.onActive(false);
            return;
          }
          current.onActive(false);
          const decision = classifyFileDrop(payload.paths, current.kind, current.busy);
          if (!decision.ok) {
            current.onError(decision.message);
            return;
          }
          try {
            void Promise.resolve(current.onDrop(decision.path)).catch(() => {
              if (!disposed) latest.current.onError("Could not open dropped file.");
            });
          } catch {
            if (!disposed) latest.current.onError("Could not open dropped file.");
          }
        });
        if (disposed) stop();
        else unlisten = stop;
      } catch {
        if (!disposed) latest.current.onError("Could not enable file dropping.");
      }
    });
    registration.current = setup;

    return () => {
      disposed = true;
      unlisten?.();
      latest.current.onActive(false);
    };
  }, [options.enabled]);
}
