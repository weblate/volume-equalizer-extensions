# Review remediation acceptance results

Acceptance was completed on 2026-09-13 in Windows using Node.js 25.9.0, npm 11.12.1, and Chromium 151.0.7922.34. The GitHub Actions workflow continues to use Node.js 24.

## Automated checks

The final commands were run from the remediation worktree and exited with code 0:

| Check | Command | Result |
| --- | --- | --- |
| Formatting | `npm run format:check` | Exit 0; all matched files formatted |
| ESLint | `npm run lint` | Exit 0 |
| TypeScript | `npm run typecheck` | Exit 0 |
| Unit and integration tests | `npm test` | Exit 0; 63 files, 276 tests passed |
| Extension build | `npm run build` | Exit 0; all four entry points built |
| Localization | `npm run lint:locales` | Exit 0; 19 locales passed |
| Knowledge graph | `graphify update .` | Exit 0; no topology changes after the final source update |

The production bundle sizes were 13.71 kB for the background worker, 77.66 kB for the popup, 8.47 kB for the isolated content script, and 7.72 kB for the main-world content script.

## Browser checks exercised

The unpacked `dist/` extension was loaded in headless Chromium against a same-origin page playing a generated WAV file. The smoke run completed without page errors and observed:

- spectrum demand became active while the popup was open and frames reached the popup;
- closing the popup removed demand and stopped the frame count at 69;
- spectrum frames were not written to the legacy `spectrum.<tabId>` storage key;
- settings remained focusable at browser zoom factors 1 and 2;
- switching the popup from Russian to English completed without missing-key failures;
- invalid preset JSON did not change storage;
- a valid preset imported as `[{ "freq": 1000, "gain": 2, "q": 0.5, "type": "peaking" }]`, without canvas `x` or `y` coordinates;
- the equalizer canvas exposed its accessible name and responded to keyboard editing;
- 100 pointer moves produced one animation-frame draw, no backing-store resize, and one persisted settings write;
- closing the popup during a second drag persisted the final immutable filter snapshot.

The smoke artifact reported 9 spectrum frames at the observation point while the popup was open, 69 frames when it closed, and the same 69-frame count after the post-close wait.

## Audio graph and heap evidence

The browser fixture exercised pause/resume and 100 media replacements. The pre-remediation baseline created 11 contexts after 10 replacements and 21 analysers. After remediation, the extension kept one context and one analyser after both 10 and 100 replacements, with zero fixture failures.

Forced-GC diagnostics showed that Blink retains `MediaElementAudioSourceNode` wrappers while their shared `AudioContext` remains live, even after graph edges are disconnected. Closing the extension-owned context on final non-BFCache page teardown released the detached media/source pairs. This native retention means object counts during the live document are not reported as a fixed JavaScript leak.

## Scenarios not exercised in the final headless run

The final headless environment could not audibly verify output, DRM media, permitted and denied cross-origin sources, real browser-window tab capture, or BFCache navigation. It also did not exercise every locale visually. The capture-start/stop, late-stream cleanup, rapid A/B/A selection, multiple-tab isolation, detached media reuse, page-owned Web Audio, and service-worker reconnection paths are covered by focused unit or integration tests, but they remain items for manual release testing in a headed browser using the accompanying checklist.

The smoke checklist deliberately remains unchecked so a release tester can record a separate headed-browser run rather than inheriting results from this partial automation.
