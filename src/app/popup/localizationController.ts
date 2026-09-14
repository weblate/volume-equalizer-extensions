import {
  DEFAULT_LANGUAGE,
  LANGUAGE_KEY,
  resolveLanguageCode,
} from "../../domains/localization/languages";
import {
  loadLocaleMessages,
  type LocaleMessages,
} from "../../infrastructure/localization/localeLoader";
import {
  applyLocalization as applyPopupLocalization,
  populateLanguageSelect as populatePopupLanguageSelect,
} from "../../ui/popup/applyLocalization";

export interface LocalizationService {
  ready: Promise<void>;
  getMessage(messageName: string): string;
  applyLocalization(root?: Document): void;
  populateLanguageSelect(root?: Document): void;
  setLanguage(
    language: string,
    options?: {
      save?: boolean;
      refreshDynamicContent?: () => Promise<void>;
    },
  ): Promise<void>;
}

export const createLocalizationService = (): LocalizationService => {
  let currentLanguage = DEFAULT_LANGUAGE;
  let currentMessages: LocaleMessages = {};
  let defaultMessages: LocaleMessages = {};
  let languageGeneration = 0;
  let languageSaveQueue = Promise.resolve();

  const getMessage = (messageName: string): string =>
    currentMessages[messageName]?.message ||
    defaultMessages[messageName]?.message ||
    chrome.i18n.getMessage(messageName) ||
    messageName;

  const applyLocalization = (root: Document = document): void => {
    applyPopupLocalization(root, getMessage);
  };

  const populateLanguageSelect = (root: Document = document): void => {
    populatePopupLanguageSelect(root, currentLanguage);
  };

  const applyCurrentLanguage = (): void => {
    if (!globalThis.document) return;
    document.documentElement.lang = currentLanguage.replace("_", "-");
    applyLocalization(document);
    populateLanguageSelect(document);
  };

  const setLanguage = async (
    language: string,
    options: {
      save?: boolean;
      refreshDynamicContent?: () => Promise<void>;
    } = {},
  ): Promise<void> => {
    const generation = ++languageGeneration;
    const resolvedLanguage = resolveLanguageCode(language);
    let messages: LocaleMessages;
    try {
      messages = await loadLocaleMessages(resolvedLanguage);
    } catch (error) {
      if (generation === languageGeneration) {
        console.error("Failed to load locale", { language: resolvedLanguage, error });
        applyCurrentLanguage();
      }
      return;
    }
    if (generation !== languageGeneration) return;
    if (Object.keys(messages).length === 0) {
      console.error("Failed to load locale", {
        language: resolvedLanguage,
        error: "Empty locale",
      });
      applyCurrentLanguage();
      return;
    }

    currentLanguage = resolvedLanguage;
    currentMessages = messages;
    applyCurrentLanguage();
    if (options.save) {
      let savedLatest = false;
      const save = languageSaveQueue.then(async () => {
        if (generation !== languageGeneration) return;
        await chrome.storage.local.set({ [LANGUAGE_KEY]: resolvedLanguage });
        savedLatest = generation === languageGeneration;
      });
      languageSaveQueue = save.catch(() => undefined);
      await save;
      if (!savedLatest) return;
      await options.refreshDynamicContent?.();
    }
  };

  const initLocalization = async (): Promise<void> => {
    try {
      defaultMessages = await loadLocaleMessages(DEFAULT_LANGUAGE);
    } catch (error) {
      console.error("Failed to load default locale", {
        language: DEFAULT_LANGUAGE,
        error,
      });
    }
    const stored = await chrome.storage.local.get([LANGUAGE_KEY]);
    const browserLocale = chrome.i18n.getMessage("@@ui_locale") || navigator.language;
    const language =
      typeof stored[LANGUAGE_KEY] === "string"
        ? stored[LANGUAGE_KEY]
        : resolveLanguageCode(browserLocale);
    await setLanguage(language);
  };

  return {
    ready: initLocalization(),
    getMessage,
    applyLocalization,
    populateLanguageSelect,
    setLanguage,
  };
};
