import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function connect(page: Page) {
  const address = process.env.E2E_SSHD_ADDR!;
  const split = address.lastIndexOf(":");
  await page.goto("/");
  await page.getByLabel(/^Host$/i).fill(address.slice(0, split));
  await page.getByLabel(/^Port$/i).fill(address.slice(split + 1));
  await page.getByLabel(/^Username$/i).fill("tester");
  await page.getByLabel(/^Password$/i).fill("s3cret");
  await page.getByRole("button", { name: /^Connect to server$/i }).tap();
  await page.getByRole("button", { name: /trust and connect/i }).tap();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
}

async function captureSessionInput(page: Page) {
  await page.addInitScript(() => {
    const sent: string[] = [];
    (window as Window & { sentInput: string[] }).sentInput = sent;
    let connector: typeof window.sshConnect;
    Object.defineProperty(window, "sshConnect", {
      configurable: true,
      get: () => connector,
      set(value: typeof window.sshConnect) {
        connector = async (...args) => {
          const session = await value(...args);
          (window as Window & { testSession: typeof session }).testSession = session;
          const write = session.write.bind(session);
          session.write = (chunk) => {
            sent.push(new TextDecoder().decode(chunk));
            return write(chunk);
          };
          return session;
        };
      },
    });
  });
}

/**
 * Selects the first occurrence of `text` in a mirrored row. The text may span
 * several text nodes, as it does where xterm draws the cursor cell.
 */
async function selectMirrorText(page: Page, text: string) {
  await page.locator(".terminal-touch-rows").evaluate((rows, needle) => {
    for (const row of Array.from(rows.children)) {
      const index = row.textContent!.indexOf(needle);
      if (index < 0) continue;
      const pointAt = (offset: number): [Node, number] => {
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node && offset > node.textContent!.length) {
          offset -= node.textContent!.length;
          node = walker.nextNode();
        }
        return [node!, offset];
      };
      const range = document.createRange();
      range.setStart(...pointAt(index));
      range.setEnd(...pointAt(index + needle.length));
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error(`Missing mirror text: ${needle}`);
  }, text);
}

async function editMirror(page: Page, inputType: string, data: string | null = null) {
  await page.locator(".terminal-touch-text").evaluate(
    (element, edit) => {
      element.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: edit.inputType,
          data: edit.data,
        }),
      );
    },
    { inputType, data },
  );
}

test("editable host owns touch focus and follows keyboard intent", async ({ page }) => {
  await connect(page);
  const host = page.locator(".terminal-touch-text");
  await expect(host).toHaveAttribute("contenteditable", "plaintext-only");
  await expect(host).toHaveAttribute("autocorrect", "off");
  await expect(host).toHaveAttribute("autocapitalize", "off");
  await expect(host).toHaveAttribute("spellcheck", "false");
  await expect(host).toHaveAttribute("enterkeyhint", "enter");
  await expect(host).toHaveAttribute("aria-label", "Terminal input and text selection");
  await expect(host).not.toHaveAttribute("aria-hidden", "true");
  await expect(host.locator(".terminal-touch-rows")).toHaveAttribute("aria-hidden", "true");
  await expect(
    page.getByRole("textbox", { name: "Terminal input and text selection" }),
  ).toHaveCount(1);
  await expect(host).toHaveCSS("opacity", "1");
  await expect(host).toHaveCSS("outline-style", "none");
  const bounds = await host.boundingBox();
  const screen = await page.locator(".xterm-screen").boundingBox();
  expect(bounds?.width).toBeCloseTo(screen!.width, 0);
  expect(bounds?.height).toBeCloseTo(screen!.height, 0);
  if (await page.getByRole("button", { name: /hide keyboard/i }).isVisible()) {
    await page.getByRole("button", { name: /hide keyboard/i }).tap();
  }
  await expect(host).toHaveAttribute("inputmode", "none");
  await page.getByRole("button", { name: /show keyboard/i }).tap();
  await expect(host).toHaveAttribute("inputmode", "text");
  await expect(host).toBeFocused();
  await expect(page.locator(".xterm-helper-textarea")).not.toBeFocused();
  await page.getByRole("button", { name: /hide keyboard/i }).tap();
  await expect(host).toHaveAttribute("inputmode", "none");
});

test("touch uses the editable host without a URL flag", async ({ page }) => {
  await connect(page);
  await expect(page.locator(".terminal-touch-text")).toHaveAttribute(
    "contenteditable",
    "plaintext-only",
  );
  await expect(page.locator(".xterm-helper-textarea")).not.toBeFocused();
});

test("Command copy and paste keep their native key handling", async ({ page }) => {
  await captureSessionInput(page);
  await connect(page);
  const result = await page.locator(".terminal-touch-text").evaluate((element) =>
    ["c", "v"].map((key) => {
      const event = new KeyboardEvent("keydown", {
        key,
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  );
  expect(result).toEqual([false, false]);
  expect(await page.evaluate(() => (window as Window & { sentInput: string[] }).sentInput)).toEqual(
    [],
  );
});

test("hardware keys on the touch host reach the session once", async ({ page }) => {
  await captureSessionInput(page);
  await connect(page);
  await expect(page.locator(".terminal-touch-text")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Control+C");
  await page.keyboard.type("ab");
  await expect
    .poll(() =>
      page.evaluate(() => (window as Window & { sentInput: string[] }).sentInput.join("")),
    )
    .toBe("\x1b[A\x03ab");
  await expect(page.locator(".xterm-helper-textarea")).not.toBeFocused();
});

test("beforeinput routes keys once without editing the mirror", async ({ page }) => {
  await connect(page);
  const host = page.locator(".terminal-touch-text");
  const result = await host.evaluate((element) => {
    const before = element.innerHTML;
    const event = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: "ls",
    });
    element.dispatchEvent(event);
    return { cancelled: event.defaultPrevented, unchanged: element.innerHTML === before };
  });
  expect(result).toEqual({ cancelled: true, unchanged: true });
  await expect(page.locator(".xterm-rows")).toContainText("ls");
  await expect(host).toContainText("ls");
  await page.waitForTimeout(200);
  expect((await page.locator(".xterm-rows").textContent())?.match(/ls/g)).toHaveLength(1);
});

test("editing keys map to terminal bytes and unsupported edits are cancelled", async ({ page }) => {
  await connect(page);
  const host = page.locator(".terminal-touch-text");
  const cancelled = await host.evaluate((element) =>
    [
      ["insertText", "q"],
      ["insertReplacementText", "zzrep"],
      ["insertParagraph", null],
      ["deleteContentBackward", null],
      ["formatBold", null],
    ].map(([inputType, data]) => {
      const event = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: inputType!,
        data,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  );
  expect(cancelled).toEqual([true, true, true, true, true]);
  await expect(page.locator(".xterm-rows")).toContainText("q");
  // A replacement that names no target text is uncertain and sends nothing.
  await expect(page.locator(".xterm-rows")).not.toContainText("zzrep");
});

test("composition sends committed text once and restores the mirror", async ({ page }) => {
  await connect(page);
  const host = page.locator(".terminal-touch-text");
  await host.evaluate((element) => {
    element.querySelector(".terminal-touch-rows > div")!.textContent = "browser mutation";
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "é" }));
  });
  await expect(page.locator(".xterm-rows")).toContainText("é");
  await expect(host).not.toContainText("browser mutation");
  await page.waitForTimeout(200);
  expect((await page.locator(".xterm-rows").textContent())?.match(/é/g)).toHaveLength(1);
});

test("paste routes plain text to the session once", async ({ page }) => {
  await connect(page);
  const host = page.locator(".terminal-touch-text");
  await host.evaluate((element) => {
    const data = new DataTransfer();
    data.setData("text/plain", "plain-paste");
    element.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }),
    );
  });
  await expect(page.locator(".xterm-rows")).toContainText("plain-paste");
  await page.waitForTimeout(200);
  expect((await page.locator(".xterm-rows").textContent())?.match(/plain-paste/g)).toHaveLength(1);
});

test("touch gestures on the editing host stay native", async ({ page }) => {
  await connect(page);
  const host = page.locator(".terminal-touch-text");
  await page.getByRole("button", { name: "Hide keyboard" }).tap();
  const result = await host.evaluate((element) => {
    let captures = 0;
    const original = Element.prototype.setPointerCapture;
    Element.prototype.setPointerCapture = () => {
      captures++;
    };
    const down = new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerType: "touch",
      pointerId: 1,
    });
    element.dispatchEvent(down);
    element.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerType: "touch",
        pointerId: 1,
      }),
    );
    Element.prototype.setPointerCapture = original;
    return { prevented: down.defaultPrevented, captures };
  });
  expect(result).toEqual({ prevented: false, captures: 0 });
  const box = (await host.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(host).toBeFocused();
  await expect(page.locator(".xterm-helper-textarea")).not.toBeFocused();
  await expect(host).toHaveAttribute("inputmode", "none");
});

test("empty paste is cancelled without changing the editing host", async ({ page }) => {
  await connect(page);
  const host = page.locator(".terminal-touch-text");
  const cancelled = await host.evaluate((element) => {
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: new DataTransfer(),
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(cancelled).toBe(true);
});

test("output updates preserve an editable host selection", async ({ page }) => {
  await captureSessionInput(page);
  await connect(page);
  const host = page.locator(".terminal-touch-text");
  await editMirror(page, "insertText", "old\r\n");
  await expect(host).toContainText("old");
  await selectMirrorText(page, "old");
  const selected = await page.evaluate(() => document.getSelection()!.toString());
  await page.evaluate(() => {
    (
      window as Window & { testSession: { write: (chunk: Uint8Array) => string | null } }
    ).testSession.write(new TextEncoder().encode("updated"));
  });
  await expect(page.locator(".xterm-rows")).toContainText("updated");
  expect(await page.evaluate(() => document.getSelection()!.toString())).toBe(selected);
});

test("focused caret keeps live mirror output and stays inside the host", async ({ page }) => {
  await connect(page);
  const host = page.locator(".terminal-touch-text");
  await expect(host).toBeFocused();
  await host.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element.querySelector(".terminal-touch-rows > div")!);
    range.collapse(false);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: "fresh-output",
      }),
    );
  });
  await expect(page.locator(".xterm-rows")).toContainText("fresh-output");
  await expect(host).toContainText("fresh-output");
  await expect(host).toBeFocused();
  const caret = await host.evaluate((element) => {
    const selection = document.getSelection()!;
    return (
      selection.rangeCount === 1 &&
      selection.isCollapsed &&
      !!selection.anchorNode &&
      element.contains(selection.anchorNode)
    );
  });
  expect(caret).toBe(true);
});

test("Backspace deletes every selected prompt character through the session", async ({ page }) => {
  await captureSessionInput(page);
  await connect(page);
  await editMirror(page, "insertText", "abcXYZ");
  await expect(page.locator(".terminal-touch-text")).toContainText("abcXYZ");
  await selectMirrorText(page, "abc");
  await page.evaluate(() => {
    (window as Window & { sentInput: string[] }).sentInput.length = 0;
  });
  await editMirror(page, "deleteContentBackward");
  await expect
    .poll(() =>
      page.evaluate(() => (window as Window & { sentInput: string[] }).sentInput.join("")),
    )
    .toBe("\x1b[D".repeat(3) + "\x7f".repeat(3));
});

test("Backspace on output selection sends nothing; typing goes to the cursor", async ({ page }) => {
  await captureSessionInput(page);
  await connect(page);
  await editMirror(page, "insertText", "archive\r\n");
  await expect(page.locator(".terminal-touch-text")).toContainText("archive");
  await selectMirrorText(page, "archive");
  await page.evaluate(() => {
    (window as Window & { sentInput: string[] }).sentInput.length = 0;
  });
  await editMirror(page, "deleteContentBackward");
  expect(await page.evaluate(() => (window as Window & { sentInput: string[] }).sentInput)).toEqual(
    [],
  );
  expect(await page.evaluate(() => document.getSelection()?.isCollapsed)).toBe(false);
  await editMirror(page, "insertText", "typed");
  await expect.poll(() => sentInput(page)).toBe("typed");
  expect(await page.evaluate(() => document.getSelection()?.isCollapsed)).toBe(true);
});

test("Enter over an output selection drops it and runs the command", async ({ page }) => {
  await captureSessionInput(page);
  await connect(page);
  await editMirror(page, "insertText", "archive\r\n");
  await editMirror(page, "insertText", "ls");
  await expect(page.locator(".terminal-touch-text")).toContainText("archive");
  await selectMirrorText(page, "archive");
  await clearSentInput(page);
  await editMirror(page, "insertParagraph");
  await expect.poll(() => sentInput(page)).toBe("\r");
  expect(await page.evaluate(() => document.getSelection()?.isCollapsed)).toBe(true);
});

for (const [inputType, data] of [
  ["deleteContentForward", null],
  ["deleteByCut", null],
  ["insertText", "Q"],
  ["insertReplacementText", "R"],
] as const) {
  test(`${inputType} replaces a selected prompt range`, async ({ page }) => {
    await captureSessionInput(page);
    await connect(page);
    await editMirror(page, "insertText", "abcXYZ");
    await expect(page.locator(".terminal-touch-text")).toContainText("abcXYZ");
    await selectMirrorText(page, "abc");
    await page.evaluate(() => {
      (window as Window & { sentInput: string[] }).sentInput.length = 0;
    });
    await editMirror(page, inputType, data);
    const expected = "\x1b[D".repeat(3) + "\x7f".repeat(3) + (data ?? "");
    await expect
      .poll(() =>
        page.evaluate(() => (window as Window & { sentInput: string[] }).sentInput.join("")),
      )
      .toBe(expected);
    expect(await page.evaluate(() => document.getSelection()?.isCollapsed)).toBe(true);
  });
}

function sentInput(page: Page) {
  return page.evaluate(() => (window as Window & { sentInput: string[] }).sentInput.join(""));
}

async function clearSentInput(page: Page) {
  await page.evaluate(() => {
    (window as Window & { sentInput: string[] }).sentInput.length = 0;
  });
}

/** Selects from `from[1]` characters into the first `from[0]` to `to[1]` into `to[0]`. */
async function selectBetween(page: Page, from: [string, number], to: [string, number]) {
  await page.locator(".terminal-touch-rows").evaluate(
    (rows, [start, end]) => {
      const find = ([needle, offset]: [string, number]) => {
        const walker = document.createTreeWalker(rows, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const index = node.textContent!.indexOf(needle);
          if (index >= 0) return [node, index + offset] as const;
        }
        throw new Error(`Missing mirror text: ${needle}`);
      };
      const range = document.createRange();
      range.setStart(...find(start!));
      range.setEnd(...find(end!));
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    },
    [from, to] as const,
  );
}

test("paste over an output selection sends only the paste and drops the highlight", async ({
  page,
}) => {
  await captureSessionInput(page);
  await connect(page);
  const host = page.locator(".terminal-touch-text");
  await editMirror(page, "insertText", "old\r\n");
  await expect(host).toContainText("old");
  await selectMirrorText(page, "old");
  await clearSentInput(page);
  await host.evaluate((element) => {
    const data = new DataTransfer();
    data.setData("text/plain", "pasted");
    element.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }),
    );
  });
  await expect.poll(() => sentInput(page)).toBe("pasted");
  expect(await page.evaluate(() => document.getSelection()?.isCollapsed)).toBe(true);
  await expect(host).toBeFocused();
  // The copy follows output again instead of staying frozen under a highlight.
  await page.evaluate(() => {
    (
      window as Window & { testSession: { write: (chunk: Uint8Array) => string | null } }
    ).testSession.write(new TextEncoder().encode(" fresh"));
  });
  await expect(host).toContainText("pasted fresh");
});

test("paste over selected command input replaces it once", async ({ page }) => {
  await captureSessionInput(page);
  await connect(page);
  const host = page.locator(".terminal-touch-text");
  await editMirror(page, "insertText", "abcXYZ");
  await expect(host).toContainText("abcXYZ");
  await selectMirrorText(page, "abc");
  await clearSentInput(page);
  await host.evaluate((element) => {
    const data = new DataTransfer();
    data.setData("text/plain", "Q");
    element.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }),
    );
  });
  await expect.poll(() => sentInput(page)).toBe("\x1b[D".repeat(3) + "\x7f".repeat(3) + "Q");
  expect(await page.evaluate(() => document.getSelection()?.isCollapsed)).toBe(true);
});

/** Writes bytes to the session; the test server echoes them back as output. */
async function serverEcho(page: Page, text: string) {
  await page.evaluate((chunk) => {
    (
      window as Window & { testSession: { write: (chunk: Uint8Array) => string | null } }
    ).testSession.write(new TextEncoder().encode(chunk));
  }, text);
}

test("a selection across a hard row break of a multi-line command sends nothing", async ({
  page,
}) => {
  await captureSessionInput(page);
  await connect(page);
  const host = page.locator(".terminal-touch-text");
  await editMirror(page, "insertText", "echo a");
  await expect(host).toContainText("echo a");
  // A hard row break inside the input: the line editor's buffer is uncertain.
  await serverEcho(page, "\r\n");
  await editMirror(page, "insertText", "echo b");
  await expect(host).toContainText("echo b");
  await selectBetween(page, ["echo a", 5], ["echo b", 4]);
  await clearSentInput(page);
  await editMirror(page, "deleteContentBackward");
  await selectMirrorText(page, "echo b");
  await editMirror(page, "deleteContentBackward");
  await page.waitForTimeout(200);
  expect(await sentInput(page)).toBe("");
});

test("Backspace deletes a selection in a long command that wraps", async ({ page }) => {
  await captureSessionInput(page);
  await connect(page);
  const host = page.locator(".terminal-touch-text");
  // Longer than a phone row, so "tail" lands on an autowrapped row.
  const command = "head" + "x".repeat(100) + "tail";
  await editMirror(page, "insertText", command);
  await expect(host).toContainText("tail");
  await selectBetween(page, ["head", 1], ["tail", 2]);
  await clearSentInput(page);
  await editMirror(page, "deleteContentBackward");
  // Back over "il", then delete "ead", every x, and "ta".
  await expect.poll(() => sentInput(page)).toBe("\x1b[D".repeat(2) + "\x7f".repeat(3 + 100 + 2));
});

test("a right prompt is never deleted as input", async ({ page }) => {
  await captureSessionInput(page);
  await connect(page);
  const host = page.locator(".terminal-touch-text");
  await editMirror(page, "insertText", "git st");
  // zsh RPROMPT: save the cursor, draw the clock further right, restore.
  await serverEcho(page, "\x1b7\x1b[25G12:34\x1b8");
  await expect(host).toContainText("12:34");
  await selectMirrorText(page, "12:34");
  await clearSentInput(page);
  await editMirror(page, "deleteContentBackward");
  await page.waitForTimeout(200);
  expect(await sentInput(page)).toBe("");
});

test("paste over a completion listing name pastes at the cursor without deleting", async ({
  page,
}) => {
  await captureSessionInput(page);
  await connect(page);
  const host = page.locator(".terminal-touch-text");
  await editMirror(page, "insertText", "ls /e");
  // Tab Tab: bash prints the listing and redraws the prompt and input below.
  await serverEcho(page, "\r\nzetc  zexports\r\nls /e");
  await expect(host).toContainText("zexports");
  await selectMirrorText(page, "zetc");
  await clearSentInput(page);
  await host.evaluate((element) => {
    const data = new DataTransfer();
    data.setData("text/plain", "X");
    element.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }),
    );
  });
  await expect.poll(() => sentInput(page)).toBe("X");
  expect(await page.evaluate(() => document.getSelection()?.isCollapsed)).toBe(true);
});

test("selection edits in the alternate screen send nothing", async ({ page }) => {
  await captureSessionInput(page);
  await connect(page);
  const host = page.locator(".terminal-touch-text");
  // vim: alternate screen, insert mode, two lines typed.
  await serverEcho(page, "\x1b[?1049h");
  await editMirror(page, "insertText", "abc");
  await serverEcho(page, "\r\n");
  await editMirror(page, "insertText", "def");
  await expect(host).toContainText("def");
  await selectMirrorText(page, "b");
  await clearSentInput(page);
  await editMirror(page, "deleteContentBackward");
  await selectMirrorText(page, "de");
  await editMirror(page, "deleteContentBackward");
  await page.waitForTimeout(200);
  expect(await sentInput(page)).toBe("");
});

test("a predictive replacement deletes the partial word it replaces", async ({ page }) => {
  await captureSessionInput(page);
  await connect(page);
  const host = page.locator(".terminal-touch-text");
  await editMirror(page, "insertText", "old");
  await editMirror(page, "insertParagraph");
  await serverEcho(page, "\n");
  await editMirror(page, "insertText", "hel");
  await expect(host).toContainText("hel");
  const replace = (needle: string, data: string) =>
    host.evaluate(
      (element, [word, text]) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const start = node.textContent!.indexOf(word!);
          if (start < 0) continue;
          const caret = document.createRange();
          caret.setStart(node, start + word!.length);
          document.getSelection()!.removeAllRanges();
          document.getSelection()!.addRange(caret);
          const target = new StaticRange({
            startContainer: node,
            startOffset: start,
            endContainer: node,
            endOffset: start + word!.length,
          });
          const event = new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            inputType: "insertReplacementText",
            data: text,
            targetRanges: [target],
          });
          // Target ranges are only readable while the event dispatches.
          let targeted = false;
          element.addEventListener(
            "beforeinput",
            (seen) => {
              targeted = (seen as InputEvent).getTargetRanges().length > 0;
            },
            { once: true, capture: true },
          );
          element.dispatchEvent(event);
          return targeted;
        }
        throw new Error(`Missing mirror text: ${word}`);
      },
      [needle, data],
    );
  await clearSentInput(page);
  // WebKit drops synthetic target ranges; without one nothing may be sent.
  const targeted = await replace("hel", "hello");
  if (targeted) await expect.poll(() => sentInput(page)).toBe("\x7f".repeat(3) + "hello");
  else {
    await page.waitForTimeout(200);
    expect(await sentInput(page)).toBe("");
  }
  // A replacement whose target cannot be deleted sends nothing rather than doubling text.
  await clearSentInput(page);
  await replace("old", "older");
  await page.waitForTimeout(200);
  expect(await sentInput(page)).toBe("");
});

test("a selection reaching from output into the input deletes nothing", async ({ page }) => {
  await captureSessionInput(page);
  await connect(page);
  const host = page.locator(".terminal-touch-text");
  await editMirror(page, "insertText", "archive\r\n");
  await editMirror(page, "insertText", "abc");
  await expect(host).toContainText("abc");
  await selectBetween(page, ["archive", 2], ["abc", 2]);
  await clearSentInput(page);
  await editMirror(page, "deleteContentBackward");
  await page.waitForTimeout(200);
  expect(await sentInput(page)).toBe("");
  // Typing is not blocked: it drops the selection and goes to the cursor.
  await editMirror(page, "insertText", "typed");
  await expect.poll(() => sentInput(page)).toBe("typed");
});

test("word and line deletion keys and repeated Backspace reach the shell", async ({ page }) => {
  await captureSessionInput(page);
  await connect(page);
  await expect(page.locator(".terminal-touch-text")).toBeFocused();
  for (const inputType of [
    "deleteContentBackward",
    "deleteContentBackward",
    "deleteContentBackward",
    "deleteWordBackward",
    "deleteSoftLineBackward",
    "deleteHardLineBackward",
  ]) {
    await editMirror(page, inputType);
  }
  await expect.poll(() => sentInput(page)).toBe("\x7f\x7f\x7f\x1b\x7f\x15\x15");
});

test("an active composition keeps its row until it ends, then sends once", async ({ page }) => {
  await captureSessionInput(page);
  await connect(page);
  const host = page.locator(".terminal-touch-text");
  const kept = await host.evaluate((element) => {
    const row = element.querySelector(".terminal-touch-rows > div")!;
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    row.textContent = "composing";
    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertCompositionText",
        data: "composing",
        isComposing: true,
      }),
    );
    return element.querySelector(".terminal-touch-rows > div") === row;
  });
  expect(kept).toBe(true);
  await expect(host).toContainText("composing");
  // Output during the composition does not replace the composing row.
  await page.evaluate(() => {
    (
      window as Window & { testSession: { write: (chunk: Uint8Array) => string | null } }
    ).testSession.write(new TextEncoder().encode("out"));
  });
  await expect(page.locator(".xterm-rows")).toContainText("out");
  await expect(host).toContainText("composing");
  await clearSentInput(page);
  await host.evaluate((element) =>
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日" })),
  );
  await expect.poll(() => sentInput(page)).toBe("日");
  await expect(host).not.toContainText("composing");
  await expect(host).toContainText("out日");
});

test("IME and soft-keyboard keydowns are left to the browser", async ({ page }) => {
  await captureSessionInput(page);
  await connect(page);
  const prevented = await page.locator(".terminal-touch-text").evaluate((element) =>
    [
      { key: "Unidentified", keyCode: 229 },
      { key: "Process", keyCode: 229 },
      { key: "a", keyCode: 229 },
      { key: "Dead", keyCode: 54 },
    ].map(({ key, keyCode }) => {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      Object.defineProperty(event, "keyCode", { value: keyCode });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  );
  expect(prevented).toEqual([false, false, false, false]);
  expect(await sentInput(page)).toBe("");
});

test("Alt with a letter keeps xterm's Escape prefix off Mac platforms", async ({ page }) => {
  await captureSessionInput(page);
  await connect(page);
  const prevented = await page.locator(".terminal-touch-text").evaluate((element) => {
    const event = new KeyboardEvent("keydown", {
      key: "b",
      code: "KeyB",
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "keyCode", { value: 66 });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await expect.poll(() => sentInput(page)).toBe("\x1bb");
});

test.describe("Mac platform, as iPadOS reports", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel" });
    });
  });

  test("Option characters reach the shell once through text input", async ({ page }) => {
    await captureSessionInput(page);
    await connect(page);
    const host = page.locator(".terminal-touch-text");
    const prevented = await host.evaluate((element) =>
      [
        { key: "@", code: "KeyL", keyCode: 76 },
        { key: "∫", code: "KeyB", keyCode: 66 },
      ].map(({ key, code, keyCode }) => {
        const event = new KeyboardEvent("keydown", {
          key,
          code,
          altKey: true,
          bubbles: true,
          cancelable: true,
        });
        Object.defineProperty(event, "keyCode", { value: keyCode });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    );
    expect(prevented).toEqual([false, false]);
    expect(await sentInput(page)).toBe("");
    await editMirror(page, "insertText", "@");
    await editMirror(page, "insertText", "∫");
    await expect.poll(() => sentInput(page)).toBe("@∫");
  });
});

test("native blur and focus keep the key bar keyboard toggle in step", async ({ page }) => {
  await connect(page);
  const host = page.locator(".terminal-touch-text");
  await expect(host).toBeFocused();
  await expect(page.getByRole("button", { name: "Hide keyboard" })).toBeVisible();
  // iOS's hide-keyboard key, or a tap on another control, blurs the host natively.
  await host.evaluate((element: HTMLElement) => element.blur());
  await expect(page.getByRole("button", { name: "Show keyboard" })).toBeVisible();
  await expect(host).toHaveAttribute("inputmode", "none");
  // A native focus with the keyboard hidden keeps reporting it hidden.
  await host.evaluate((element: HTMLElement) => element.focus());
  await expect(host).toBeFocused();
  await expect(page.getByRole("button", { name: "Show keyboard" })).toBeVisible();
  await page.getByRole("button", { name: "Show keyboard" }).tap();
  await expect(host).toHaveAttribute("inputmode", "text");
  await expect(page.getByRole("button", { name: "Hide keyboard" })).toBeVisible();
});

test("an inactive tab's editing host sends no input or paste", async ({ page }) => {
  await captureSessionInput(page);
  await connect(page);
  await page.getByRole("button", { name: "Open terminals" }).tap();
  await page
    .getByRole("tablist", { name: "Open terminals" })
    .getByRole("button", { name: "New terminal" })
    .tap();
  const address = process.env.E2E_SSHD_ADDR!;
  const split = address.lastIndexOf(":");
  await page.getByLabel(/^Host$/i).fill(address.slice(0, split));
  await page.getByLabel(/^Port$/i).fill(address.slice(split + 1));
  await page.getByLabel(/^Username$/i).fill("tester");
  await page.getByLabel(/^Password$/i).fill("s3cret");
  await page.getByRole("button", { name: /^Connect to server$/i }).tap();
  const trust = page.getByRole("button", { name: /trust and connect/i });
  const hosts = page.locator(".terminal-touch-text");
  await expect(trust.or(hosts.nth(1))).toBeVisible();
  if (await trust.isVisible()) await trust.tap();
  await expect(hosts).toHaveCount(2);
  await expect(hosts.nth(1)).toBeFocused();
  await clearSentInput(page);
  await hosts.first().evaluate((element) => {
    element.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: "hidden-tab",
      }),
    );
    const data = new DataTransfer();
    data.setData("text/plain", "hidden-paste");
    element.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }),
    );
  });
  await page.waitForTimeout(200);
  expect(await sentInput(page)).toBe("");
});

test("an autosuggestion drawn after the cursor is never deleted as input", async ({ page }) => {
  await captureSessionInput(page);
  await connect(page);
  const host = page.locator(".terminal-touch-text");
  await editMirror(page, "insertText", "git ch");
  await expect(host).toContainText("git ch");
  // fish: draw the suggestion after the cursor, then move the cursor back.
  await serverEcho(page, "eck");
  await expect(host).toContainText("git check");
  await serverEcho(page, "\x1b[3D");
  await expect(host).toContainText("git check");
  await selectMirrorText(page, "eck");
  await clearSentInput(page);
  await editMirror(page, "deleteContentBackward");
  await page.waitForTimeout(200);
  expect(await sentInput(page)).toBe("");
  await selectMirrorText(page, "ch");
  await editMirror(page, "deleteContentBackward");
  await expect.poll(() => sentInput(page)).toBe("\x7f\x7f");
});

test("Tab makes selection deletion unavailable", async ({ page }) => {
  await captureSessionInput(page);
  await connect(page);
  const host = page.locator(".terminal-touch-text");
  await editMirror(page, "insertText", "hello");
  await expect(host).toContainText("hello");
  await editMirror(page, "insertText", "\t");
  await selectMirrorText(page, "ell");
  await clearSentInput(page);
  await editMirror(page, "deleteContentBackward");
  expect(await sentInput(page)).toBe("");
});

for (const bracketed of [false, true])
  test(`${bracketed ? "bracketed" : "plain"} pasted text can be selected and deleted`, async ({
    page,
  }) => {
    await captureSessionInput(page);
    await connect(page);
    const host = page.locator(".terminal-touch-text");
    if (bracketed) await serverEcho(page, "\x1b[?2004h");
    await host.evaluate((element) => {
      const data = new DataTransfer();
      data.setData("text/plain", "pasted");
      element.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }),
      );
    });
    await expect(host).toContainText("pasted");
    await selectMirrorText(page, "pasted");
    await clearSentInput(page);
    await editMirror(page, "deleteContentBackward");
    await expect.poll(() => sentInput(page)).toBe("\x7f".repeat(6));
  });

test("ArrowUp makes selection deletion unavailable", async ({ page }) => {
  await captureSessionInput(page);
  await connect(page);
  const host = page.locator(".terminal-touch-text");
  await editMirror(page, "insertText", "hello");
  await expect(host).toContainText("hello");
  await page.keyboard.press("ArrowUp");
  await selectMirrorText(page, "ell");
  await clearSentInput(page);
  await editMirror(page, "deleteContentBackward");
  expect(await sentInput(page)).toBe("");
});

for (const separator of ["\n", "\r"])
  test(`a paste containing ${JSON.stringify(separator)} makes selection deletion unavailable`, async ({
    page,
  }) => {
    await captureSessionInput(page);
    await connect(page);
    const host = page.locator(".terminal-touch-text");
    await editMirror(page, "insertText", "hello");
    await expect(host).toContainText("hello");
    await host.evaluate((element, separator) => {
      const data = new DataTransfer();
      data.setData("text/plain", `a${separator}b`);
      element.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }),
      );
    }, separator);
    await selectMirrorText(page, "ell");
    await clearSentInput(page);
    await editMirror(page, "deleteContentBackward");
    expect(await sentInput(page)).toBe("");
  });

test("typing over selected typed text replaces that text", async ({ page }) => {
  await captureSessionInput(page);
  await connect(page);
  const host = page.locator(".terminal-touch-text");
  await editMirror(page, "insertText", "abcXYZ");
  await expect(host).toContainText("abcXYZ");
  await selectMirrorText(page, "abc");
  await clearSentInput(page);
  await editMirror(page, "insertText", "Q");
  await expect.poll(() => sentInput(page)).toBe("\x1b[D".repeat(3) + "\x7f".repeat(3) + "Q");
});

test("a selection over a row that changed after it froze sends nothing", async ({ page }) => {
  await captureSessionInput(page);
  await connect(page);
  const host = page.locator(".terminal-touch-text");
  await editMirror(page, "insertText", "hello");
  await expect(host).toContainText("hello");
  await selectMirrorText(page, "lo");
  // A late echo of Left, Left, X redraws the line as "helXlo" under the selection.
  await serverEcho(page, "\x1b[2DXlo\x1b[2D");
  await expect(page.locator(".xterm-rows")).toContainText("helXlo");
  await expect(host).toContainText("hello");
  await clearSentInput(page);
  await editMirror(page, "deleteContentBackward");
  await page.waitForTimeout(200);
  expect(await sentInput(page)).toBe("");
});

test("a column change forgets the tracked command input", async ({ page }) => {
  await captureSessionInput(page);
  await connect(page);
  const host = page.locator(".terminal-touch-text");
  await editMirror(page, "insertText", "abcXYZ");
  await expect(host).toContainText("abcXYZ");
  await page.setViewportSize({ width: 340, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.querySelector(".xterm-rows > div")!.clientWidth))
    .toBeLessThan(330);
  await selectMirrorText(page, "abc");
  await clearSentInput(page);
  await editMirror(page, "deleteContentBackward");
  await page.waitForTimeout(200);
  expect(await sentInput(page)).toBe("");
});

test.describe("tablet key bar", () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test("a selection edit skips an armed Alt, which stays armed", async ({ page }) => {
    await captureSessionInput(page);
    await connect(page);
    const host = page.locator(".terminal-touch-text");
    await editMirror(page, "insertText", "abcXYZ");
    await expect(host).toContainText("abcXYZ");
    const alt = page.getByRole("button", { name: /^alt$/i });
    await alt.tap();
    await expect(alt).toHaveAttribute("aria-pressed", "true");
    await selectMirrorText(page, "abc");
    await clearSentInput(page);
    await editMirror(page, "deleteContentBackward");
    await expect.poll(() => sentInput(page)).toBe("\x1b[D".repeat(3) + "\x7f".repeat(3));
    await expect(alt).toHaveAttribute("aria-pressed", "true");
    await editMirror(page, "insertText", "q");
    await expect.poll(() => sentInput(page)).toBe("\x1b[D".repeat(3) + "\x7f".repeat(3) + "\x1bq");
  });
});
