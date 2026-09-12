import {
  formatShortcut,
  isModifierShortcutKey,
  normalizeShortcutFromKeyboardEvent,
  SHORTCUT_ACTION_MUTE_NAME,
  SHORTCUT_ACTION_TOGGLE_EQ_NAME,
  resolveShortcuts,
  validateShortcutConfig,
  type ShortcutActionName,
  type ShortcutMap,
} from "../../domains/shortcuts/shortcuts";

export const createShortcutSettingsView = (deps: {
  muteInput: HTMLInputElement;
  toggleEqInput: HTMLInputElement;
  error: HTMLElement;
  getMessage(messageName: string): string;
  saveShortcuts(shortcuts: ShortcutMap): Promise<void>;
}) => {
  let savedShortcuts = resolveShortcuts(null);
  let requestedShortcuts = savedShortcuts;
  let interactionGeneration = 0;
  let saveQueue = Promise.resolve();
  const inputs: Record<ShortcutActionName, HTMLInputElement> = {
    [SHORTCUT_ACTION_MUTE_NAME]: deps.muteInput,
    [SHORTCUT_ACTION_TOGGLE_EQ_NAME]: deps.toggleEqInput,
  };

  const setError = (messageName: string | null): void => {
    deps.error.textContent = messageName ? deps.getMessage(messageName) : "";
    deps.error.style.display = messageName ? "block" : "none";
  };
  const render = (invalidAction: ShortcutActionName | null = null): void => {
    Object.entries(inputs).forEach(([action, input]) => {
      input.value = formatShortcut(savedShortcuts[action as ShortcutActionName]);
      input.classList.toggle("invalid", action === invalidAction);
    });
  };

  Object.entries(inputs).forEach(([name, input]) => {
    const action = name as ShortcutActionName;
    input.addEventListener("focus", () => {
      input.value = "?";
      input.classList.remove("invalid");
      setError(null);
    });
    input.addEventListener("blur", () => {
      setError(null);
      render();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Tab") return;
      event.preventDefault();
      event.stopPropagation();
      if (isModifierShortcutKey(event.key)) return;
      const generation = ++interactionGeneration;
      const shortcut = normalizeShortcutFromKeyboardEvent(event);
      if (!shortcut) {
        setError("shortcut_validation_error");
        input.classList.add("invalid");
        return;
      }
      const next = resolveShortcuts({ ...requestedShortcuts, [action]: shortcut });
      const validation = validateShortcutConfig(next);
      if (validation) {
        setError(
          validation === "duplicate" ? "shortcut_duplicate_error" : "shortcut_validation_error",
        );
        render(action);
        return;
      }
      requestedShortcuts = next;
      saveQueue = saveQueue.then(
        () => deps.saveShortcuts(next),
        () => deps.saveShortcuts(next),
      );
      void saveQueue
        .then(() => {
          savedShortcuts = next;
          if (generation !== interactionGeneration) return;
          requestedShortcuts = next;
          setError(null);
          render();
        })
        .catch((error: unknown) => {
          console.error("Failed to save shortcut settings", { action, error });
          if (generation !== interactionGeneration) return;
          requestedShortcuts = savedShortcuts;
          setError("shortcut_validation_error");
          render(action);
        });
    });
  });

  return {
    setShortcuts: (value: Partial<ShortcutMap> | null | undefined): void => {
      savedShortcuts = resolveShortcuts(value);
      requestedShortcuts = savedShortcuts;
      render();
    },
    getShortcuts: (): ShortcutMap => savedShortcuts,
  };
};
