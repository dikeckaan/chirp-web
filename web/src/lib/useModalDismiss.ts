import { useEffect, useRef } from "react";

/**
 * Modal a11y helper: close on Escape, move focus into the dialog on
 * mount, and restore focus to the previously focused element on unmount.
 *
 * The keydown listener reads the latest `onClose` via a ref so the
 * effect runs once (focus isn't stolen on every re-render). Attach the
 * returned ref to the dialog element and give it `tabIndex={-1}`.
 */
export function useModalDismiss<T extends HTMLElement = HTMLDivElement>(
  onClose: () => void,
) {
  const ref = useRef<T>(null);
  const cb = useRef(onClose);
  cb.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cb.current();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, []);

  return ref;
}
