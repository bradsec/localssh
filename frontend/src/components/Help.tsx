import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { HelpContext, useHelp, type HelpApi } from "../helpContext.js";
import { filterHelpTopics, HELP_TOPICS, helpTopicLabel, type HelpTopicId } from "../helpTopics.js";
import { Icon } from "./Icon.js";

/**
 * Where focus goes when Help closes. The element that asked for Help can be
 * gone (a closed session) or hidden in a menu that closed meanwhile; the menu's
 * own toggle stands in for the second, and the Help button for the first.
 */
function resolveReturnFocus(element: HTMLElement | null): HTMLElement | null {
  if (element?.isConnected && element !== document.body) {
    const closedMenu = element.closest("details:not([open])");
    return closedMenu?.querySelector<HTMLElement>("summary") ?? element;
  }
  return document.querySelector<HTMLElement>("[data-help-trigger]");
}

export function HelpProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ isOpen: boolean; topic: HelpTopicId | null }>({
    isOpen: false,
    topic: null,
  });
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const pendingFocusRef = useRef(0);
  useEffect(() => () => cancelAnimationFrame(pendingFocusRef.current), []);

  const openHelp = useCallback((topic?: HelpTopicId, returnFocus?: HTMLElement | null) => {
    // A close in the frame before must not pull focus out of the new dialog.
    cancelAnimationFrame(pendingFocusRef.current);
    returnFocusRef.current =
      returnFocus ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setState({ isOpen: true, topic: topic ?? null });
  }, []);

  const closeHelp = useCallback(() => {
    const returnFocus = returnFocusRef.current;
    returnFocusRef.current = null;
    setState((current) => ({ ...current, isOpen: false }));
    // After the dialog unmounts, so focus does not land back inside it.
    pendingFocusRef.current = requestAnimationFrame(() => resolveReturnFocus(returnFocus)?.focus());
  }, []);

  const api = useMemo<HelpApi>(
    () => ({ ...state, openHelp, closeHelp }),
    [state, openHelp, closeHelp],
  );
  return <HelpContext.Provider value={api}>{children}</HelpContext.Provider>;
}

/** The toolbar Help button and, while open, the Help dialog. */
export function Help() {
  const help = useHelp();
  // What had focus when the pointer went down on the button, before the press
  // moved it. During a session that is the terminal, which gets focus back on
  // close so typing (and a phone's keyboard) carries on where it was.
  const pointerFocusRef = useRef<HTMLElement | null>(null);
  if (!help) return null;

  return (
    <>
      <button
        className="toolbar-button help__trigger"
        type="button"
        data-help-trigger
        aria-haspopup="dialog"
        aria-expanded={help.isOpen}
        onPointerDown={() => {
          pointerFocusRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onClick={(event) => {
          const prior = pointerFocusRef.current;
          pointerFocusRef.current = null;
          help.openHelp(undefined, prior && prior !== document.body ? prior : event.currentTarget);
        }}
      >
        <Icon name="info" />
        <span className="toolbar-label">Help</span>
      </button>
      {help.isOpen &&
        // Portalled out of the toolbar, whose stacking context would otherwise
        // keep the dialog under the host-key prompt it may be opened from.
        createPortal(<HelpDialog topic={help.topic} onClose={help.closeHelp} />, document.body)}
    </>
  );
}

function HelpDialog({ topic, onClose }: { topic: HelpTopicId | null; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [query, setQuery] = useState("");
  // An object, so asking for the same topic twice still scrolls to it again.
  const [shown, setShown] = useState<{ topic: HelpTopicId | null }>({ topic });
  const topics = filterHelpTopics(query);
  const trimmed = query.trim();

  useEffect(() => {
    const heading = shown.topic
      ? dialogRef.current?.querySelector<HTMLElement>(`#help-${shown.topic}-title`)
      : titleRef.current;
    heading?.scrollIntoView?.({ block: "start" });
    heading?.focus({ preventScroll: true });
  }, [shown]);

  function showTopic(id: HelpTopicId) {
    setQuery("");
    setShown({ topic: id });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      // Menus that close on Escape listen on the document; this Escape is
      // Help's alone, so an open Clipboard menu behind it stays open.
      event.stopPropagation();
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;

    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === titleRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="help-backdrop"
      data-help-dialog
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="help__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        onKeyDown={handleKeyDown}
      >
        <div className="help__header">
          <h2 id="help-title" ref={titleRef} tabIndex={-1}>
            Help with localssh
          </h2>
          <button className="button help__close" type="button" onClick={onClose}>
            Close
          </button>
          <label className="field help__search">
            <span>Search help</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="search"
            />
          </label>
        </div>

        <nav aria-label="Help topics">
          <ul className="help__topics">
            {HELP_TOPICS.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => showTopic(item.id)}>
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <p className="help__results" aria-live="polite">
          {trimmed === ""
            ? ""
            : topics.length === 0
              ? `No help topics match "${trimmed}". Try another word, or clear the search.`
              : `${topics.length} ${topics.length === 1 ? "topic matches" : "topics match"} "${trimmed}".`}
        </p>

        {topics.map((item) => (
          <section key={item.id} id={`help-${item.id}`} aria-labelledby={`help-${item.id}-title`}>
            <h3 id={`help-${item.id}-title`} tabIndex={-1}>
              {item.heading}
            </h3>
            {item.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {item.link && (
              <a href={item.link.href} target="_blank" rel="noreferrer noopener">
                {item.link.text}
              </a>
            )}
          </section>
        ))}
      </section>
    </div>
  );
}

/** Opens Help at `topic`. Renders nothing outside a HelpProvider. */
export function LearnMore({ topic }: { topic: HelpTopicId }) {
  const help = useHelp();
  if (!help) return null;
  return (
    <button
      className="learn-more"
      type="button"
      onClick={(event) => help.openHelp(topic, event.currentTarget)}
    >
      Learn more{" "}
      <span className="visually-hidden">about {helpTopicLabel(topic).toLowerCase()}</span>
    </button>
  );
}
