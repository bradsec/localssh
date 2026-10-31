import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Help, HelpProvider, LearnMore } from "./Help.js";

function renderHelp(extra?: React.ReactNode) {
  return render(
    <HelpProvider>
      <Help />
      {extra}
    </HelpProvider>,
  );
}

describe("Help", () => {
  it("opens as a labelled dialog and closes with Escape, returning focus", async () => {
    renderHelp();
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "Help" });

    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Help with localssh" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(within(dialog).getByRole("heading", { name: "Help with localssh" })).toHaveFocus();
    expect(within(dialog).getByRole("heading", { name: "Check the host key" })).toBeVisible();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("closes from its Close button and from the backdrop", async () => {
    renderHelp();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Help" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.pointerDown(document.querySelector("[data-help-dialog]")!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens at a named topic from Learn more and returns focus to the link", async () => {
    renderHelp(<LearnMore topic="clipboard" />);
    const user = userEvent.setup();
    const link = screen.getByRole("button", { name: "Learn more about copy and paste" });

    await user.click(link);
    expect(screen.getByRole("heading", { name: "Copy and paste" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(link).toHaveFocus());
  });

  it("gives focus back to what had it before the Help button was pressed", async () => {
    renderHelp(<textarea aria-label="Terminal input" />);
    const user = userEvent.setup();
    const terminal = screen.getByLabelText("Terminal input");
    terminal.focus();

    await user.click(screen.getByRole("button", { name: "Help" }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(terminal).toHaveFocus());
  });

  it("returns focus to the toggle of a menu that closed while Help was open", async () => {
    render(
      <HelpProvider>
        <Help />
        <details open>
          <summary>Clipboard</summary>
          <LearnMore topic="clipboard" />
        </details>
      </HelpProvider>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /learn more/i }));
    document.querySelector("details")!.open = false;
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByText("Clipboard")).toHaveFocus());
  });

  it("keeps Escape from reaching menus that listen on the document", async () => {
    const documentEscape = vi.fn();
    document.addEventListener("keydown", documentEscape);
    renderHelp();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Help" }));
    await user.keyboard("{Escape}");
    expect(documentEscape).not.toHaveBeenCalled();
    document.removeEventListener("keydown", documentEscape);
  });

  it("filters topics by search and says when nothing matches", async () => {
    renderHelp();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Help" }));
    const search = screen.getByRole("searchbox", { name: "Search help" });

    await user.type(search, "master password");
    expect(screen.getByRole("heading", { name: "Save a host" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Copy and paste" })).not.toBeInTheDocument();
    expect(screen.getByText(/topics? match/)).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "kubernetes");
    expect(screen.getByText(/No help topics match "kubernetes"/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
  });

  it("jumps to a topic from the topic list, clearing the search", async () => {
    renderHelp();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Help" }));
    await user.type(screen.getByRole("searchbox", { name: "Search help" }), "kubernetes");

    const topics = screen.getByRole("navigation", { name: "Help topics" });
    await user.click(within(topics).getByRole("button", { name: "Self-hosting" }));
    expect(screen.getByRole("searchbox", { name: "Search help" })).toHaveValue("");
    expect(screen.getByRole("heading", { name: "Run localssh yourself" })).toHaveFocus();
  });

  it("keeps Tab inside the dialog", async () => {
    renderHelp();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Help" }));
    const dialog = screen.getByRole("dialog");
    const setupLink = within(dialog).getByRole("link", {
      name: "Read setup and update instructions",
    });

    setupLink.focus();
    await user.tab();
    expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(setupLink).toHaveFocus();
  });

  // On a narrow screen the Help button is folded into a closed Actions menu, so
  // a Learn more link must open Help without that button on the page.
  it("opens from Learn more when no Help button is mounted", async () => {
    render(
      <HelpProvider>
        <LearnMore topic="files" />
      </HelpProvider>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: /learn more/i }));

    const dialog = screen.getByRole("dialog", { name: "Help with localssh" });
    expect(
      within(dialog).getByRole("heading", { name: "Browse and transfer files" }),
    ).toBeVisible();
  });

  it("renders Learn more as nothing outside a provider", () => {
    const { container } = render(<LearnMore topic="connect" />);
    expect(container).toBeEmptyDOMElement();
  });
});
