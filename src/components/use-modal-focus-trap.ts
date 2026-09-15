import { useEffect, type RefObject } from "react";

/**
 * Keyboard behaviour every modal in this app is supposed to have.
 *
 * This exists because the behaviour was copy-pasted instead of shared, and the
 * copies drifted. Three dialogs carried a Tab trap whose container check read
 * `!container.contains(document.activeElement)`; an element contains itself, so
 * focus resting on the container matched neither that branch nor the first or
 * last control, and Shift+Tab walked out past the overlay (#119, #128). Three
 * other modals declared aria-modal and had no trap at all, so Tab left on the
 * first press.
 *
 * Fixing six copies by hand would have left seven. The trap lives here now.
 */

const focusableSelector = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

function canReceiveFocus(element: Element | null): element is HTMLElement {
  return Boolean(
    element instanceof HTMLElement &&
      element.isConnected &&
      element.getClientRects().length > 0
  );
}

export function useModalFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  onClose: (() => void) | null,
  options: { active?: boolean } = {}
) {
  const active = options.active ?? true;

  useEffect(() => {
    if (!active) return;

    const opener = canReceiveFocus(document.activeElement)
      ? document.activeElement
      : null;

    // Deferred so the dialog is laid out before anything is focused. The guard
    // and the cancellation are both load-bearing: a frame delayed by a busy
    // renderer used to land after the reader had already moved and drag focus
    // back to the first control (#127).
    const frame = window.requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      if (container.contains(document.activeElement)) return;
      const first = [...container.querySelectorAll(focusableSelector)].find(
        canReceiveFocus
      );
      (first ?? container).focus();
    });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && onClose) {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;
      const container = containerRef.current;
      if (!container) return;

      const focusable = [...container.querySelectorAll(focusableSelector)].filter(
        canReceiveFocus
      );
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable.at(-1) ?? first;
      const current = document.activeElement;

      // `current === container` is the case the hand-written copies missed.
      if (current === container || !container.contains(current)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.cancelAnimationFrame(frame);
      if (canReceiveFocus(opener)) opener.focus();
    };
  }, [active, containerRef, onClose]);
}
