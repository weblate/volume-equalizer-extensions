import { createLocalizationService } from "./localizationController";

type MessageMap = Record<string, { message: string }>;

const createResponse = (messages: MessageMap, ok = true): Response =>
  ({
    ok,
    json: vi.fn(async () => messages),
  }) as unknown as Response;

const createLocalizedElement = (i18n: string) => ({
  dataset: { i18n },
  textContent: "",
});

const createRoot = (elements: ReturnType<typeof createLocalizedElement>[]) =>
  ({
    querySelectorAll: vi.fn(() => elements),
    getElementById: vi.fn(() => null),
  }) as unknown as Document;

describe("createLocalizationService", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("chrome", {
      i18n: {
        getMessage: vi.fn((messageName: string) => (messageName === "@@ui_locale" ? "en" : "")),
      },
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://id/${path}`),
      },
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("loads default and selected messages with instance-local fallback", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(createResponse({ reset_button_label: { message: "Reset" } }))
      .mockResolvedValueOnce(createResponse({ ready: { message: "Ready" } }));

    const service = createLocalizationService();
    await service.ready;

    expect(service.getMessage("reset_button_label")).toBe("Reset");
    expect(service.getMessage("missing_key")).toBe("missing_key");
  });

  test("saves selected language and runs injected dynamic refresh", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(createResponse({}))
      .mockResolvedValueOnce(createResponse({ ready: { message: "Ready" } }))
      .mockResolvedValueOnce(createResponse({ ready: { message: "Готово" } }));
    const refreshDynamicContent = vi.fn(async () => undefined);

    const service = createLocalizationService();
    await service.ready;
    await service.setLanguage("ru", { save: true, refreshDynamicContent });

    expect(chrome.storage.local.set).toHaveBeenCalledWith({ uiLanguage: "ru" });
    expect(refreshDynamicContent).toHaveBeenCalledOnce();
  });

  test("does not save a locale whose file fails to load", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(createResponse({ reset_button_label: { message: "Reset" } }))
      .mockResolvedValueOnce(createResponse({ ready: { message: "Ready" } }))
      .mockRejectedValueOnce(new Error("network unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const service = createLocalizationService();
    await service.ready;

    await service.setLanguage("ru", { save: true });

    expect(chrome.storage.local.set).not.toHaveBeenCalledWith({ uiLanguage: "ru" });
    expect(service.getMessage("reset_button_label")).toBe("Reset");
    expect(consoleError).toHaveBeenCalled();
  });

  test("does not save a locale whose file is unavailable", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(createResponse({ reset_button_label: { message: "Reset" } }))
      .mockResolvedValueOnce(createResponse({ ready: { message: "Ready" } }))
      .mockResolvedValueOnce(createResponse({}, false));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const service = createLocalizationService();
    await service.ready;

    await service.setLanguage("ru", { save: true });

    expect(chrome.storage.local.set).not.toHaveBeenCalledWith({ uiLanguage: "ru" });
    expect(service.getMessage("reset_button_label")).toBe("Reset");
  });

  test("applies and saves only the latest deferred language request", async () => {
    let resolveDe!: (response: Response) => void;
    let resolveRu!: (response: Response) => void;
    vi.mocked(fetch)
      .mockResolvedValueOnce(createResponse({ ready: { message: "Ready" } }))
      .mockResolvedValueOnce(createResponse({ ready: { message: "Ready" } }))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveDe = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRu = resolve;
          }),
      );
    const deRefresh = vi.fn(async () => undefined);
    const ruRefresh = vi.fn(async () => undefined);
    const service = createLocalizationService();
    await service.ready;

    const de = service.setLanguage("de", { save: true, refreshDynamicContent: deRefresh });
    const ru = service.setLanguage("ru", { save: true, refreshDynamicContent: ruRefresh });
    resolveRu(createResponse({ key: { message: "RU" } }));
    await ru;
    resolveDe(createResponse({ key: { message: "DE" } }));
    await de;

    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ uiLanguage: "ru" });
    expect(deRefresh).not.toHaveBeenCalled();
    expect(ruRefresh).toHaveBeenCalledOnce();
    expect(service.getMessage("key")).toBe("RU");
  });

  test("localizes theme option labels used by settings and onboarding", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        createResponse({
          guide_theme_dark: { message: "Dark localized" },
          guide_theme_light: { message: "Light localized" },
        }),
      )
      .mockResolvedValueOnce(createResponse({ ready: { message: "Ready" } }));
    const darkOption = createLocalizedElement("guide_theme_dark");
    const lightOption = createLocalizedElement("guide_theme_light");
    const service = createLocalizationService();
    await service.ready;

    service.applyLocalization(createRoot([darkOption, lightOption]));

    expect(darkOption.textContent).toBe("Dark localized");
    expect(lightOption.textContent).toBe("Light localized");
  });

  test("localizes elements declared with data-i18n", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(createResponse({ reset_button_label: { message: "Reset localized" } }))
      .mockResolvedValueOnce(createResponse({ ready: { message: "Ready" } }));
    const element = createLocalizedElement("reset_button_label");
    const service = createLocalizationService();
    await service.ready;

    service.applyLocalization(createRoot([element]));

    expect(element.textContent).toBe("Reset localized");
  });

  test("localizes the donation reminder", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        createResponse({
          donation_reminder_title: { message: "Title localized" },
          donation_reminder_message: { message: "Message localized" },
          donation_reminder_link: { message: "Link localized" },
          ok: { message: "OK localized" },
        }),
      )
      .mockResolvedValueOnce(createResponse({ ready: { message: "Ready" } }));
    const elements = [
      createLocalizedElement("donation_reminder_title"),
      createLocalizedElement("donation_reminder_message"),
      createLocalizedElement("donation_reminder_link"),
      createLocalizedElement("ok"),
    ];
    const service = createLocalizationService();
    await service.ready;

    service.applyLocalization(createRoot(elements));

    expect(elements.map(({ textContent }) => textContent)).toEqual([
      "Title localized",
      "Message localized",
      "Link localized",
      "OK localized",
    ]);
  });
});
