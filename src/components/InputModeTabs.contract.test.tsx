// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { InputModeTabs } from "./InputModeTabs";

it("uses native disabled focus and activation semantics and restores ordinary buttons", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onChange = vi.fn();
  try {
    await act(async () => { root.render(<InputModeTabs active="image" disabled onChange={onChange} />); });
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button.disabled).toBe(true);
      expect(button.hasAttribute("tabindex")).toBe(false);
      button.focus();
      expect(document.activeElement).not.toBe(button);
      button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      button.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
      button.click();
    }
    expect(onChange).not.toHaveBeenCalled();
    expect(buttons[1].getAttribute("aria-pressed")).toBe("true");

    await act(async () => { root.render(<InputModeTabs active="text" onChange={onChange} />); });
    for (const button of buttons) {
      expect(button.disabled).toBe(false);
      expect(button.tabIndex).toBe(0);
      button.focus();
      expect(document.activeElement).toBe(button);
      button.click();
    }
    expect(onChange.mock.calls).toEqual([["text"], ["image"], ["pdf"]]);
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});
