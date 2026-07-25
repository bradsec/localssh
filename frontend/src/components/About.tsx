import { useEffect, useRef, useState } from "react";

const REPOSITORY_URL = "https://github.com/bradsec/localssh";

export function About() {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);

  // <details> only toggles from its own summary, so an open panel would other-
  // wise stay open when the user clicks or taps anywhere else on the page.
  useEffect(() => {
    if (!open) return;

    const closeOnOutside = (event: Event) => {
      if (!detailsRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      detailsRef.current?.querySelector("summary")?.focus();
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
    <details
      className="about"
      ref={detailsRef}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>About</summary>
      <div className="about__panel">
        <p className="about__lede">
          A browser SSH client. The engine runs as WebAssembly in this tab, so passwords and
          host-key decisions never reach a server.
        </p>
        <dl className="about__meta">
          <dt>Created by</dt>
          <dd>Mark Bradley (BRADSEC)</dd>
        </dl>
        <a className="about__link" href={REPOSITORY_URL} target="_blank" rel="noreferrer noopener">
          <GitHubMark />
          <span>Source on GitHub</span>
        </a>
        <p className="about__star">
          If you find this useful, please consider starring the repository. It helps others
          discover the project.
        </p>
      </div>
    </details>
  );
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
           0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01
           1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95
           0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0
           1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0
           3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01
           8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
      />
    </svg>
  );
}
