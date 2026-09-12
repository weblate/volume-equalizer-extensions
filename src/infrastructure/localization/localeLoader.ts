export type LocaleMessages = Record<string, { message?: string }>;

export const loadLocaleMessages = async (locale: string): Promise<LocaleMessages> => {
  const response = await fetch(chrome.runtime.getURL(`_locales/${locale}/messages.json`));
  if (!response.ok) return {};
  return response.json() as Promise<LocaleMessages>;
};
