import { createEqualizerState } from "../../ui/equalizerCanvas/equalizerEditorState";
import { readThemeColors } from "../../ui/theme/themeColors";
import { getPopupElements } from "../../ui/popup/popupElements";
import { createLocalizationService } from "./localizationController";
import { createPopupApp } from "./createPopupApp";

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

window.addEventListener("load", () => {
  const elements = getPopupElements(document);
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error("AudioContext is unavailable");
  }

  const app = createPopupApp({
    elements,
    audioContext: new AudioContextConstructor(),
    equalizerState: createEqualizerState(),
    localization: createLocalizationService(),
    readThemeColors,
  });

  void app.start().catch((error: unknown) => {
    console.error("Failed to start popup", { error });
    app.dispose();
  });
});
