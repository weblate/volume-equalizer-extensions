import { attachModalFocus } from "./modalFocus";
import { attachPresetDropdown } from "./presetDropdown";
import { isPresetUsedInWhitelist } from "../../domains/autostart/autostartRules";
import type { EqualizerFilter } from "../../domains/equalizer/types";
import {
  getAvailablePresetNames,
  isDefaultPresetName,
  resolvePresetFilters,
  type PresetStorage,
} from "../../domains/presets/defaultPresets";
import { validatePresetName } from "../../domains/presets/presetNameValidation";
import { STORAGE_KEYS } from "../../infrastructure/chrome/storageKeys";

export const createPresetsView = (deps: {
  dropdown: HTMLElement;
  toggle: HTMLElement;
  menu: HTMLElement;
  saveButton: HTMLButtonElement;
  saveModal: HTMLDivElement;
  saveModalClose: HTMLButtonElement;
  saveForm: HTMLFormElement;
  nameInput: HTMLInputElement;
  saveError: HTMLDivElement;
  saveCancel: HTMLButtonElement;
  isToolkitWindow: boolean;
  getMessage(messageName: string): string;
  getCurrentTabId(): Promise<number | null>;
  getCurrentFilters(): EqualizerFilter[];
  setCurrentFilters(filters: EqualizerFilter[]): void;
  saveLoadedFilters(filters: EqualizerFilter[]): Promise<void>;
  redraw(): void;
  refreshToolkitCaptureFilters(): void;
}) => {
  const saveModalFocus = attachModalFocus(deps.saveModal, deps.saveButton);
  const dropdown = attachPresetDropdown(deps.dropdown, deps.toggle, deps.menu);

  const addPresetToDropdown = (
    name: string,
    options: { deletable?: boolean } = {},
  ): void => {
    const option = document.createElement("div");
    const choice = document.createElement("button");
    choice.type = "button";
    choice.textContent = name;
    choice.className = "dropdown-item";
    choice.setAttribute("data-value", name);
    option.appendChild(choice);
    option.setAttribute("data-value", name);
    option.className = "dropdown-row";

    if (options.deletable ?? true) {
      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "close-btn";
      closeButton.setAttribute("aria-label", `${deps.getMessage("delete")}: ${name}`);
      closeButton.textContent = "\u00d7";
      closeButton.setAttribute("data-value", name);
      option.appendChild(closeButton);
    }

    deps.menu.appendChild(option);
  };

  const renderPresetNames = (
    userPresetNames: string[],
    options: { includeDefaultPresets?: boolean } = {},
  ): void => {
    Array.from(deps.menu.querySelectorAll(".dropdown-row")).forEach((item) => {
      if (item.getAttribute("data-value") !== "none") item.remove();
    });

    getAvailablePresetNames(userPresetNames, options).forEach((name) => {
      addPresetToDropdown(name, { deletable: !isDefaultPresetName(name) });
    });
  };

  const closeSaveModal = (): void => {
    saveModalFocus.close();
  };

  deps.saveButton.addEventListener("click", () => {
    deps.nameInput.value = "";
    deps.saveError.textContent = "";
    saveModalFocus.open();
    deps.nameInput.focus();
  });

  deps.saveModalClose.addEventListener("click", closeSaveModal);
  deps.saveCancel.addEventListener("click", closeSaveModal);
  deps.saveModal.addEventListener("click", (event) => {
    if (event.target === deps.saveModal) closeSaveModal();
  });
  deps.nameInput.addEventListener("input", () => {
    deps.saveError.textContent = "";
  });

  deps.saveForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      const tabId = await deps.getCurrentTabId();
      if (tabId == null) return;

      const prefs = await chrome.storage.local.get([
        STORAGE_KEYS.tabFilters(tabId),
        STORAGE_KEYS.PRESETS,
        STORAGE_KEYS.PRESET_NAMES,
      ]);
      const presets = (prefs[STORAGE_KEYS.PRESETS] ?? {}) as PresetStorage;
      const presetNames = [...((prefs[STORAGE_KEYS.PRESET_NAMES] ?? []) as string[])];
      const validation = validatePresetName(deps.nameInput.value, presetNames);
      if (validation.kind === "error") {
        deps.saveError.textContent = deps.getMessage(`preset_name_${validation.reason}_error`);
        deps.saveError.style.display = "block";
        return;
      }

      const { name } = validation;
      presets[name] =
        (prefs[STORAGE_KEYS.tabFilters(tabId)] as EqualizerFilter[]) ??
        deps.getCurrentFilters();
      presetNames.push(name);

      await chrome.storage.local.set({
        [STORAGE_KEYS.PRESETS]: presets,
        [STORAGE_KEYS.PRESET_NAMES]: presetNames,
      });
      addPresetToDropdown(name);
      closeSaveModal();
    })();
  });

  deps.menu.addEventListener("click", (event) => {
    void (async () => {
      if (!(event.target instanceof HTMLElement)) return;

      const choice = event.target.getAttribute("data-value");
      if (!choice) return;

      if (choice === "none") {
        deps.toggle.textContent = deps.getMessage("empty_preset_name");
        dropdown.close(true);
        return;
      }

      if (event.target.classList.contains("close-btn")) {
        if (isDefaultPresetName(choice)) return;

        const prefs = await chrome.storage.local.get([
          STORAGE_KEYS.PRESETS,
          STORAGE_KEYS.PRESET_NAMES,
          STORAGE_KEYS.AUTOSTART_RULES,
        ]);

        if (isPresetUsedInWhitelist(prefs[STORAGE_KEYS.AUTOSTART_RULES], choice)) {
          alert(deps.getMessage("preset_delete_error"));
          return;
        }

        const row = event.target.parentElement;
        const presets = (prefs[STORAGE_KEYS.PRESETS] ?? {}) as PresetStorage;
        const presetNames = ((prefs[STORAGE_KEYS.PRESET_NAMES] ?? []) as string[]).filter(
          (name) => name !== choice,
        );
        delete presets[choice];

        await chrome.storage.local.set({
          [STORAGE_KEYS.PRESETS]: presets,
          [STORAGE_KEYS.PRESET_NAMES]: presetNames,
        });
        const nextAction = row?.nextElementSibling?.querySelector<HTMLElement>("button") ??
          row?.previousElementSibling?.querySelector<HTMLElement>("button") ?? deps.toggle;
        row?.remove();
        nextAction.focus();
        return;
      }

      if (!event.target.classList.contains("dropdown-item")) return;

      deps.toggle.textContent =
        choice === "none" ? deps.getMessage("empty_preset_name") : choice;
      const prefs = await chrome.storage.local.get([STORAGE_KEYS.PRESETS]);
      const presets = prefs[STORAGE_KEYS.PRESETS] as PresetStorage | undefined;
      const filters = resolvePresetFilters(choice, presets);
      if (!filters) return;

      deps.setCurrentFilters(filters);
      await deps.saveLoadedFilters(deps.getCurrentFilters());
      deps.redraw();
      deps.refreshToolkitCaptureFilters();
      dropdown.close(true);
    })();
  });

  return {
    addPresetToDropdown,
    renderPresetNames,
  };
};
