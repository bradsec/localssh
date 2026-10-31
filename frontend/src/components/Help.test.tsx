import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { Help } from "./Help.js";

it("opens task help and closes it with Escape", async () => {
  render(<Help />);
  const user = userEvent.setup();

  await user.click(screen.getByRole("button", { name: "Help" }));
  expect(screen.getByRole("heading", { name: "Help with localssh" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Check the host key" })).toBeVisible();

  await user.keyboard("{Escape}");
  expect(screen.getByRole("heading", { name: "Help with localssh" })).not.toBeVisible();
});
