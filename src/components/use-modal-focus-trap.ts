import {
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject
} from "react";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

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
      element !== document.body &&
      element.isConnected &&
      element.getClientRects().length > 0
  );
}

export function useModalFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  onClose: (() => void) | null,
  options: {
    active?: boolean;
    /**
     * Where focus should land, when it should not simply be the first control.
     * A delete confirmation lists its destructive action first, so defaulting
     * to "first focusable" would open it with Delete under the reader's hands.
     */
    initialFocus?: RefObject<HTMLElement | null>;
  } = {}
) {
  const active = options.active ?? true;

  // Held in a ref so it is not a dependency. Callers pass inline arrows, which
  // have a new identity every render, so depending on it tore the effect down
  // and ran cleanup - including the opener restore - on any parent render while
  // the modal was open, taking focus out of it.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const initialFocusRef = useRef(options.initialFocus);
  initialFocusRef.current = options.initialFocus;
  const openerRef = useRef<HTMLElement | null>(null);

  useIsomorphicLayoutEffect(() => {
    if (!active) return;

    const container = containerRef.current;
    const currentActive = document.activeElement;
    if (!openerRef.current || !openerRef.current.isConnected) {
      if (
        canReceiveFocus(currentActive) &&
        (!container || !container.contains(currentActive))
      ) {
        openerRef.current = currentActive;
      }
    }
  }, [active, containerRef]);

  useEffect(() => {
    if (!active) return;

    // Deferred so the dialog is laid out before anything is focused. The guard
    // and the cancellation are both load-bearing: a frame delayed by a busy
    // renderer used to land after the reader had already moved and drag focus
    // back to the first control (#127).
    const frame = window.requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      if (container.contains(document.activeElement)) return;
      const preferred = initialFocusRef.current?.current ?? null;
      if (canReceiveFocus(preferred)) {
        preferred.focus();
        return;
      }
      const first = [...container.querySelectorAll(focusableSelector)].find(
        canReceiveFocus
      );
      (first ?? container).focus();
    });

    function onKeyDown(event: KeyboardEvent) {
      const close = onCloseRef.current;
      if (event.key === "Escape" && close) {
        event.preventDefault();
        close();
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

      // Deferred, and skipped if anything else has claimed focus. When one
      // modal layers over another the outer trap deactivates while the inner
      // one mounts; restoring immediately sent focus to the page behind, and
      // the inner trap then recorded that as ITS opener, so closing the inner
      // modal landed on the background instead of the control that opened it.
      const opener = openerRef.current;
      window.requestAnimationFrame(() => {
        const current = document.activeElement;
        const focusMovedOn =
          current instanceof HTMLElement &&
          current !== document.body &&
          current.isConnected;
        if (focusMovedOn) return;
        if (canReceiveFocus(opener)) opener.focus();
        openerRef.current = null;
      });
    };
  }, [active, containerRef]);
}
