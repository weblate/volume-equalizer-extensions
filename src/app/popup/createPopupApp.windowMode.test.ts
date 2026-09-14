import { beforeEach, describe, expect, test, vi } from "vitest";

import { RUNTIME_MESSAGES } from "../../infrastructure/chrome/runtimeMessages";
import { requestWindowMode } from "./createPopupApp";

describe("requestWindowMode", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("closes the popup only after a successful response", async () => {
    const close = vi.fn();
    const showError = vi.fn();
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    vi.stubGlobal("window", { close });

    await requestWindowMode(12, showError);

    expect(sendMessage).toHaveBeenCalledWith({
      method: RUNTIME_MESSAGES.ENABLE_WINDOW_MODE,
      tabId: 12,
    });
    expect(close).toHaveBeenCalledOnce();
    expect(showError).not.toHaveBeenCalled();
  });

  test("keeps the popup open and exposes the technical failure", async () => {
    const close = vi.fn();
    const showError = vi.fn();
    const sendMessage = vi.fn().mockResolvedValue({
      ok: false,
      error: "capture failed",
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    vi.stubGlobal("window", { close });

    await requestWindowMode(12, showError);

    expect(close).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith("Failed to enable window mode", {
      tabId: 12,
      error: "capture failed",
    });
  });
});
