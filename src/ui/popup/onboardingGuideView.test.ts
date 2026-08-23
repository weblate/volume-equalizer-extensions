import {
  GUIDE_SCREENS,
  GUIDE_SHORTCUTS,
  getGuideNavigation,
  getNextFocusIndex,
  getSpotlightPanels,
  shouldCompleteGuide,
} from "./onboardingGuideView";

describe("onboarding guide navigation", () => {
  test("keeps button explanations inside stages 4 and 5", () => {
    expect(GUIDE_SCREENS.map(({ stage }) => stage)).toEqual([
      1, 2, 3, 4, 4, 5, 5, 5, 6, 7, 8,
    ]);
    expect(getGuideNavigation(0)).toEqual({
      canGoBack: false,
      canSkip: false,
      isLast: false,
    });
    expect(getGuideNavigation(3).canSkip).toBe(true);
    expect(getGuideNavigation(GUIDE_SCREENS.length - 1).isLast).toBe(true);
  });

  test("shows the fixed Q-factor gesture with the other shortcuts", () => {
    expect(GUIDE_SHORTCUTS).toEqual([
      ["shortcut_mute_label", "Alt+M"],
      ["shortcut_toggle_eq_label", "Alt+K"],
      ["shortcut_q_factor_label", "Shift+Drag"],
    ]);
  });

  test("keeps the Q-factor explanation on the equalizer screen", () => {
    expect(GUIDE_SCREENS.find(({ target }) => target === "equalizer")).toMatchObject({
      additionalMessageKey: "q_factor_shift_hint",
    });
  });
});

test("moves backward from the dialog title to the last control", () => {
  expect(getNextFocusIndex(-1, 3, true)).toBe(2);
  expect(getNextFocusIndex(2, 3, false)).toBe(0);
});

test("completes only after skip or the final next action", () => {
  expect(shouldCompleteGuide("skip", 3)).toBe(true);
  expect(shouldCompleteGuide("next", GUIDE_SCREENS.length - 1)).toBe(true);
  expect(shouldCompleteGuide("next", 0)).toBe(false);
  expect(shouldCompleteGuide("close", 5)).toBe(false);
});

test("splits the viewport into four panels around the target", () => {
  expect(
    getSpotlightPanels(
      { left: 10, top: 20, right: 40, bottom: 60 },
      100,
      90,
    ),
  ).toEqual({
    top: { left: 0, top: 0, width: 100, height: 20 },
    left: { left: 0, top: 20, width: 10, height: 40 },
    right: { left: 40, top: 20, width: 60, height: 40 },
    bottom: { left: 0, top: 60, width: 100, height: 30 },
  });
});
