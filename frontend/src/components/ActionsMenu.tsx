import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Ellipsis } from "lucide-react";

export interface ActionsMenuProps {
  /** The session controls, given a callback that closes the menu after an action. */
  children: (close: () => void) => ReactNode;
}

/**
 * The session toolbar on a narrow screen: one labelled button that opens the
 * same controls the wide toolbar shows in a row, so none of them has to shrink
 * or overlap the brand and the session target to fit.
 *
 * It is a disclosure rather than an ARIA menu because the controls inside are
 * themselves disclosures (Clipboard, About) with fields in them.
 */
export function ActionsMenu({ children }: ActionsMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    const closeOnOutside = (event: Event) => {
      // Help opened from this menu sits on top of it: keep the menu so Help can
      // hand focus back to the button that opened it.
      if ((event.target as Element).closest?.("[data-help-dialog]")) return;
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // An open panel inside the menu takes this Escape for itself.
      if (rootRef.current?.querySelector("details[open]")) return;
      if (document.querySelector("[data-help-dialog]")) return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("focusin", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("focusin", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="actions-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        className="toolbar-button"
        type="button"
        data-actions-trigger
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <Ellipsis />
        <span>Actions</span>
      </button>
      {open && (
        <div className="actions-menu__panel" id={panelId} role="group" aria-label="Actions">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
