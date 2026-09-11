import { afterEach, describe, expect, test, vi } from "vitest";
import { STORAGE_KEYS } from "../../infrastructure/chrome/storageKeys";
import { createPresetsView } from "./presetsView";

class FakeElement extends EventTarget {
  style = { display: "" };
  textContent = "";
  value = "";
  focused = false;

  focus(): void {
    this.focused = true;
  }

  contains(): boolean {
    return false;
  }

  appendChild(): FakeElement {
    return new FakeElement();
  }

  createElement(): FakeElement {
    return new FakeElement();
  }

  setAttribute(): void {}

  getAttribute(): null {
    return null;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createPresetsView", () => {
  test("opens the save modal with a cleared field and error", () => {
    const document = new FakeElement();
    vi.stubGlobal("document", document);

    const saveButton = new FakeElement();
    const saveModal = new FakeElement();
    const nameInput = new FakeElement();
    const saveError = new FakeElement();
    nameInput.value = "stale";
    saveError.textContent = "old error";

    createPresetsView({
      dropdown: new FakeElement() as unknown as HTMLElement,
      toggle: new FakeElement() as unknown as HTMLElement,
      menu: new FakeElement() as unknown as HTMLElement,
      saveButton: saveButton as unknown as HTMLButtonElement,
      saveModal: saveModal as unknown as HTMLDivElement,
      saveModalClose: new FakeElement() as unknown as HTMLButtonElement,
      saveForm: new FakeElement() as unknown as HTMLFormElement,
      nameInput: nameInput as unknown as HTMLInputElement,
      saveError: saveError as unknown as HTMLDivElement,
      saveCancel: new FakeElement() as unknown as HTMLButtonElement,
      isToolkitWindow: false,
      getMessage: (name) => name,
      getCurrentTabId: vi.fn(async () => 1),
      getCurrentFilters: vi.fn(() => []),
      setCurrentFilters: vi.fn(),
      saveLoadedFilters: vi.fn(async () => undefined),
      redraw: vi.fn(),
      refreshToolkitCaptureFilters: vi.fn(),
    });

    saveButton.dispatchEvent(new Event("click"));

    expect(saveModal.style.display).toBe("block");
    expect(nameInput.value).toBe("");
    expect(saveError.textContent).toBe("");
    expect(nameInput.focused).toBe(true);
  });

  test("shows an error without saving a duplicate name", async () => {
    const document = new FakeElement();
    vi.stubGlobal("document", document);
    const storage = {
      get: vi.fn(async () => ({
        [STORAGE_KEYS.PRESETS]: {},
        [STORAGE_KEYS.PRESET_NAMES]: ["Mine"],
        [STORAGE_KEYS.tabFilters(1)]: [],
      })),
      set: vi.fn(async () => undefined),
    };
    vi.stubGlobal("chrome", { storage: { local: storage } });

    const nameInput = new FakeElement();
    const saveError = new FakeElement();
    const saveForm = new FakeElement();
    createPresetsView({
      dropdown: new FakeElement() as unknown as HTMLElement,
      toggle: new FakeElement() as unknown as HTMLElement,
      menu: new FakeElement() as unknown as HTMLElement,
      saveButton: new FakeElement() as unknown as HTMLButtonElement,
      saveModal: new FakeElement() as unknown as HTMLDivElement,
      saveModalClose: new FakeElement() as unknown as HTMLButtonElement,
      saveForm: saveForm as unknown as HTMLFormElement,
      nameInput: nameInput as unknown as HTMLInputElement,
      saveError: saveError as unknown as HTMLDivElement,
      saveCancel: new FakeElement() as unknown as HTMLButtonElement,
      isToolkitWindow: false,
      getMessage: (name) => name,
      getCurrentTabId: vi.fn(async () => 1),
      getCurrentFilters: vi.fn(() => []),
      setCurrentFilters: vi.fn(),
      saveLoadedFilters: vi.fn(async () => undefined),
      redraw: vi.fn(),
      refreshToolkitCaptureFilters: vi.fn(),
    });

    nameInput.value = "Mine";
    saveForm.dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(saveError.textContent).toBe("preset_name_duplicate_error");
    expect(storage.set).not.toHaveBeenCalled();
  });

  test("strips legacy canvas coordinates before saving a preset", async () => {
    vi.stubGlobal("document", new FakeElement());
    const storage = {
      get: vi.fn(async () => ({
        [STORAGE_KEYS.PRESETS]: {},
        [STORAGE_KEYS.PRESET_NAMES]: [],
        [STORAGE_KEYS.tabFilters(1)]: [
          { type: "peaking", freq: "1000", gain: "6", q: "0.5", x: 10, y: 20 },
        ],
      })),
      set: vi.fn(async () => undefined),
    };
    vi.stubGlobal("chrome", { storage: { local: storage } });
    const saveForm = new FakeElement();
    const nameInput = new FakeElement();
    nameInput.value = "Legacy";

    createPresetsView({
      dropdown: new FakeElement() as unknown as HTMLElement,
      toggle: new FakeElement() as unknown as HTMLElement,
      menu: new FakeElement() as unknown as HTMLElement,
      saveButton: new FakeElement() as unknown as HTMLButtonElement,
      saveModal: new FakeElement() as unknown as HTMLDivElement,
      saveModalClose: new FakeElement() as unknown as HTMLButtonElement,
      saveForm: saveForm as unknown as HTMLFormElement,
      nameInput: nameInput as unknown as HTMLInputElement,
      saveError: new FakeElement() as unknown as HTMLDivElement,
      saveCancel: new FakeElement() as unknown as HTMLButtonElement,
      isToolkitWindow: false,
      getMessage: (name) => name,
      getCurrentTabId: vi.fn(async () => 1),
      getCurrentFilters: vi.fn(() => []),
      setCurrentFilters: vi.fn(),
      saveLoadedFilters: vi.fn(async () => undefined),
      redraw: vi.fn(),
      refreshToolkitCaptureFilters: vi.fn(),
    });

    saveForm.dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(storage.set).toHaveBeenCalledWith({
      [STORAGE_KEYS.PRESETS]: {
        Legacy: [{ type: "peaking", freq: 1000, gain: 6, q: 0.5 }],
      },
      [STORAGE_KEYS.PRESET_NAMES]: ["Legacy"],
    });
  });
});

// Modal keyboard/inert behavior is exercised separately; these tests cover view actions.
vi.mock("./modalFocus", () => ({
  attachModalFocus: (modal: HTMLElement) => ({
    open: () => { modal.style.display = "block"; },
    close: () => {
      modal.style.display = "none";
      modal.dispatchEvent(new Event("modal-closed"));
    },
  }),
}));
