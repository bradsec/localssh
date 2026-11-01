import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToastProvider } from "./Toasts.js";
import { useToast } from "../toast.js";

let show!: ReturnType<typeof useToast>;

function Trigger() {
  const toast = useToast();
  useEffect(() => {
    show = toast;
  }, [toast]);
  return <button type="button">Keep focus</button>;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("shows four newest toasts without moving focus and announces by severity", () => {
  render(
    <ToastProvider>
      <Trigger />
    </ToastProvider>,
  );
  const trigger = screen.getByRole("button", { name: "Keep focus" });
  trigger.focus();
  act(() => {
    show("one", "success");
    show("two", "info");
    show("three", "warning");
    show("four", "error");
    show("five", "success");
  });
  expect(screen.queryByText("one")).toBeNull();
  expect(screen.getAllByRole("button", { name: "Dismiss" })).toHaveLength(4);
  expect(screen.getByRole("status")).toHaveTextContent("five");
  expect(document.querySelector('.toast-region[aria-live="assertive"]')).toHaveTextContent("four");
  expect(document.activeElement).toBe(trigger);
});

it("expires non-errors after 3500 ms and errors after 5000 ms", () => {
  render(
    <ToastProvider>
      <Trigger />
    </ToastProvider>,
  );
  act(() => {
    show("Saved", "success");
    show("Failed", "error");
  });
  act(() => vi.advanceTimersByTime(3500));
  act(() => vi.advanceTimersByTime(160));
  expect(screen.queryByText("Saved")).toBeNull();
  expect(screen.getByText("Failed")).toBeVisible();
  act(() => vi.advanceTimersByTime(1340));
  act(() => vi.advanceTimersByTime(160));
  expect(screen.queryByText("Failed")).toBeNull();
});

it("pauses the remaining time during hover and focus", () => {
  render(
    <ToastProvider>
      <Trigger />
    </ToastProvider>,
  );
  act(() => show("Saved", "success"));
  const toast = screen.getByText("Saved").closest(".toast")!;
  act(() => vi.advanceTimersByTime(1000));
  fireEvent.mouseEnter(toast);
  act(() => vi.advanceTimersByTime(5000));
  expect(screen.getByText("Saved")).toBeVisible();
  fireEvent.mouseLeave(toast);
  act(() => vi.advanceTimersByTime(1000));
  fireEvent.focus(screen.getByRole("button", { name: "Dismiss" }));
  act(() => vi.advanceTimersByTime(5000));
  expect(screen.getByText("Saved")).toBeVisible();
  fireEvent.blur(screen.getByRole("button", { name: "Dismiss" }));
  act(() => vi.advanceTimersByTime(1500));
  act(() => vi.advanceTimersByTime(160));
  expect(screen.queryByText("Saved")).toBeNull();
});

it("dismisses a toast", () => {
  render(
    <ToastProvider>
      <Trigger />
    </ToastProvider>,
  );
  act(() => show("Saved", "success"));
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  act(() => vi.advanceTimersByTime(160));
  expect(screen.queryByText("Saved")).toBeNull();
});

it("allows isolated components without a provider", () => {
  expect(() => render(<Trigger />)).not.toThrow();
  expect(() => show("Saved", "success")).not.toThrow();
});
