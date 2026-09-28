// Fixed illustration only: no scanner, file input, storage, telemetry or requests.
export const steps = [
  {
    kicker: "STEP 1 / INSPECT",
    title: "Find the details you did not mean to send.",
    example:
      "customer=alex@example.com\nhost=192.168.12.44\nstatus=connection_timeout",
    description:
      "In the desktop app, review suggested replacements before cleaning. This example contains an email address and a private IP.",
  },
  {
    kicker: "STEP 2 / CLEAN",
    title: "Keep the context. Replace the selected details.",
    example: "customer=[EMAIL]\nhost=[PRIVATE_IP]\nstatus=connection_timeout",
    description:
      "The desktop app creates a separate cleaned copy. Your original is kept unchanged, and intentional exceptions stay visible.",
  },
  {
    kicker: "STEP 3 / CHECK",
    title: "Check the copy you will actually share.",
    example:
      "Save a separate copy\nRead the saved-output check result\nInspect it yourself before sharing",
    description:
      "The desktop app checks the saved output with supported detectors. An incomplete check or remaining finding needs review. This illustration has not scanned or saved a file.",
  },
];

export function initDemo(root = document) {
  const controls = root.querySelector(".demo-controls");
  if (!controls) return;
  const buttons = [...controls.querySelectorAll("button[data-step]")];
  buttons.forEach((button, index) => {
    button.addEventListener("click", () => {
      const step = steps[index];
      for (const key of ["kicker", "title", "example", "description"]) {
        root.getElementById(`demo-${key}`).textContent = step[key];
      }
      buttons.forEach((item, selected) =>
        item.setAttribute("aria-pressed", String(selected === index)),
      );
    });
  });
  controls.hidden = false;
}

if (typeof document !== "undefined") initDemo();
