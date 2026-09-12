import {
  AVAILABLE_LANGUAGE_CODES,
  DEFAULT_LANGUAGE,
  getLanguageName,
  resolveLanguageCode,
} from "./languages";

describe("resolveLanguageCode", () => {
  test("uses exact supported locale matches", () => {
    expect(resolveLanguageCode("pt_PT")).toBe("pt_PT");
  });

  test("does not use partial language matches", () => {
    expect(AVAILABLE_LANGUAGE_CODES).not.toContain("pt");
    expect(resolveLanguageCode("pt")).toBe(DEFAULT_LANGUAGE);
  });
});

test("uses the native display name for Chrome locale codes", () => {
  const expected = new Intl.DisplayNames(["en"], { type: "language" }).of("pt-PT");

  expect(getLanguageName("pt_PT")).toBe(expected);
});
