import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { DEFAULT_KEY_ORDER, KEY_BAR_KEYS, type TerminalKey } from "../terminalKeys.js";

interface KeyBarEditorProps {
  order: readonly string[];
  /** Keys that fit the row on this screen; omitted until the bar is measured. */
  capacity?: number;
  /** Persists a new order. */
  onChange: (order: string[]) => { ok: boolean };
  onBack: () => void;
  onClose: () => void;
}

type Control = "up" | "down" | "remove" | "add";

const spoken = (key: TerminalKey) => key.ariaLabel ?? key.label;

/**
 * Sub-view of Settings that reorders, removes and adds key bar keys. Buttons
 * are the only way to reorder, so no pointer path or drag is needed.
 */
export function KeyBarEditor({ order, capacity, onChange, onBack, onClose }: KeyBarEditorProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const controls = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<string | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // Runs after the new order renders, so the control it names exists.
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    (controls.current.get(target) ?? backRef.current)?.focus();
  }, [order]);

  const keys = order.flatMap((id) => KEY_BAR_KEYS.find((key) => key.id === id) ?? []);
  const unused = KEY_BAR_KEYS.filter((key) => !order.includes(key.id));

  const apply = (next: string[], message: string, focus: string) => {
    pendingFocus.current = focus;
    const result = onChange(next);
    setStatus(result.ok ? message : `${message} Could not save on this device.`);
  };

  const move = (index: number, delta: -1 | 1, control: "up" | "down") => {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    const [id] = next.splice(index, 1);
    next.splice(target, 0, id as string);
    const key = keys[index] as TerminalKey;
    apply(
      next,
      `${spoken(key)} moved to position ${target + 1} of ${next.length}.`,
      `${id}:${control}`,
    );
  };

  const remove = (index: number) => {
    const key = keys[index] as TerminalKey;
    const next = order.filter((id) => id !== key.id);
    const neighbour = next[index] ?? next[index - 1];
    apply(next, `${spoken(key)} removed.`, neighbour ? `${neighbour}:remove` : "back");
  };

  const add = (key: TerminalKey) =>
    apply([...order, key.id], `${spoken(key)} added.`, `${key.id}:remove`);

  const reset = () =>
    apply(
      [...DEFAULT_KEY_ORDER],
      "Key bar reset to the default keys.",
      `${DEFAULT_KEY_ORDER[0]}:remove`,
    );

  const ref = (id: string, control: Control) => (node: HTMLButtonElement | null) => {
    if (node) controls.current.set(`${id}:${control}`, node);
    else controls.current.delete(`${id}:${control}`);
  };

  const showDivider = capacity !== undefined && capacity < keys.length;

  return (
    <>
      <header className="settings-dialog__header">
        <button className="button" type="button" ref={backRef} onClick={onBack}>
          Settings
        </button>
        <h2 id="settings-title" ref={titleRef} tabIndex={-1}>
          Key bar
        </h2>
        <button className="button" type="button" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="settings-dialog__body">
        <p className="settings-dialog__hint">
          The row shows keys in this order, as many as fit. The rest open from More keys.
        </p>
        <p className="key-editor__fixed">
          <span className="key-editor__face">Keyboard</span> always first
        </p>
        <ul className="key-editor__list">
          {keys.map((key, index) => {
            const name = spoken(key);
            return (
              <li key={key.id} className="key-editor__item">
                {showDivider && index === capacity && (
                  <div className="key-editor__divider">
                    Below this line: in More keys on this screen
                  </div>
                )}
                <div className="key-editor__row">
                  <span className="key-editor__label">
                    <span className="key-editor__face">{key.label}</span>
                    {name !== key.label && <span className="key-editor__name">{name}</span>}
                  </span>
                  <button
                    className="key-editor__button"
                    type="button"
                    ref={ref(key.id, "up")}
                    aria-label={`Move ${name} up`}
                    aria-disabled={index === 0}
                    onClick={() => move(index, -1, "up")}
                  >
                    <ChevronUp aria-hidden="true" />
                  </button>
                  <button
                    className="key-editor__button"
                    type="button"
                    ref={ref(key.id, "down")}
                    aria-label={`Move ${name} down`}
                    aria-disabled={index === keys.length - 1}
                    onClick={() => move(index, 1, "down")}
                  >
                    <ChevronDown aria-hidden="true" />
                  </button>
                  <button
                    className="key-editor__button"
                    type="button"
                    ref={ref(key.id, "remove")}
                    aria-label={`Remove ${name} from the key bar`}
                    onClick={() => remove(index)}
                  >
                    <X aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {unused.length > 0 && (
          <>
            <h3>Not in key bar</h3>
            <ul className="key-editor__list">
              {unused.map((key) => (
                <li key={key.id} className="key-editor__item">
                  <div className="key-editor__row">
                    <span className="key-editor__label">
                      <span className="key-editor__face">{key.label}</span>
                      {spoken(key) !== key.label && (
                        <span className="key-editor__name">{spoken(key)}</span>
                      )}
                    </span>
                    <button
                      className="key-editor__button"
                      type="button"
                      aria-label={`Add ${spoken(key)} to the key bar`}
                      onClick={() => add(key)}
                    >
                      <Plus aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        <button className="button" type="button" onClick={reset}>
          Reset key bar
        </button>
        <p className="settings-dialog__status" role="status">
          {status}
        </p>
      </div>
    </>
  );
}
