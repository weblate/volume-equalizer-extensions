# Task 4 report: audio graph and analyser lifetime

## Result

- Added a weak `mediaGraphRegistry` backed by `WeakMap` and iterable `WeakRef` entries. Iteration prunes collected keys and does not keep media or source nodes alive through a global strong set.
- Added `spectrumSampler`, which owns one analyser per active context, reuses analyser and typed-array buffers, and disconnects only its own `output -> analyser` edge on graph changes, stop, and disposal.
- Content-main now uses one lazily created extension-owned `AudioContext` per document for media elements, reuses each element's `MediaElementAudioSourceNode`, and closes only that owned context on final non-bfcache `pagehide`.
- Equalizer disable/enable removes and restores only extension-owned edges. Page-owned branches from the same source remain connected.
- Added coverage for pause/resume, detached `new Audio()`, removal and reinsertion of the same video, multiple page-owned branches, one shared owned context, analyser reuse, exact disconnection, weak-registry cleanup, and final teardown ownership.

## Red/green evidence

The sampler mutation replaced the exact disconnect with a broad `output.disconnect()`:

```text
npx vitest run src/infrastructure/audio/spectrumSampler.test.ts
Test Files  1 failed (1)
Tests       1 failed | 1 passed (2)
```

The failure showed that stop removed the page-owned destination connection and did not call `disconnect(analyser)`. Restoring the exact edge removal made the sampler suite pass.

Final focused verification:

```text
npx vitest run src/infrastructure/audio src/app/content-main
Test Files  3 passed (3)
Tests       24 passed (24)

npm run typecheck
exit 0

npm run build
exit 0; all four Vite targets built

git diff --check
exit 0

graphify update .
Rebuilt: 713 nodes, 1379 edges, 42 communities
```

## Browser and heap evidence

The extension fixture was exercised in Chromium with pause/resume and 100 media replacements:

```text
node .superpowers/sdd/2026-09-06-project-review-remediation/audio-heap-task-4.cjs
```

| Measurement | Baseline | Task 4 |
| --- | ---: | ---: |
| Contexts after 10 replacements | 11 | 1 |
| Analysers after 10 replacements | 21 | 1 |
| Contexts after 100 replacements | - | 1 |
| Analysers after 100 replacements | - | 1 |
| Failures | 0 | 0 |

After 100 replacements and forced GC, the live document retained 101 `HTMLAudioElement` and 101 `MediaElementAudioSourceNode` objects. A final non-bfcache `pagehide` reduced both to 1 and removed the analyser; the one live DOM element remained until document destruction.

Two follow-up diagnostics isolated the remaining retention:

```text
node .superpowers/sdd/2026-09-06-project-review-remediation/audio-retention-rootcause.cjs
node .superpowers/sdd/2026-09-06-project-review-remediation/audio-retaining-paths-task-4.cjs
```

The controlled 30-element matrix retained 0 media/source pairs for DOM-only and `captureStream()`-only cases, 30/30 for a live shared context, and still 30/30 after explicitly disconnecting every source and gain edge. Closing the context released all pairs. The heap path was `GC roots -> C++ Persistent roots -> Pending activities -> MediaElementAudioSourceNode -> detached audio`.

This is native Blink/Web Audio retention tied to the live `AudioContext`, not a JavaScript registry or a remaining graph connection. Disconnecting on pause or removal cannot release it and would weaken required pause/resume, detached playback, and element reinsertion behavior. Closing the shared context before final document teardown is also invalid because a media element cannot be captured into a second `MediaElementAudioSourceNode`. The implementation therefore closes the owned context at final page teardown, where the diagnostic releases all detached pairs.

## Window-mode review remediation

The window-mode controller had its own spectrum loop instead of using the shared sampler. It retained the `output -> analyser` edge after spectrum stop and allocated a new frequency buffer on every tick. It also created a new analyser when the active capture or graph changed.

Regression tests reproduced all four cases before the fix:

```text
npx vitest run src/app/window-mode/createToolkitWindowController.test.ts
Test Files  1 failed (1)
Tests       4 failed | 22 passed (26)
```

The controller now delegates sampling to `createSpectrumSampler`. The sampler owns and reuses its analyser and typed-array buffers, removes only its exact analyser edge when stopping or switching outputs, and is disposed during full capture teardown. Active graph teardown stops the sampler before broad extension-owned graph disconnection. The existing Task 7 controller interfaces remain unchanged.

Final focused verification:

```text
npx vitest run src/app/window-mode/createToolkitWindowController.test.ts
Test Files  1 passed (1)
Tests       26 passed (26)

npx vitest run src/infrastructure/audio src/app/content-main src/app/window-mode
Test Files  4 passed (4)
Tests       50 passed (50)

npm run typecheck
exit 0
```

The native Blink/Web Audio retention limitation documented above is unchanged; the controller fix addresses the removable analyser edge and per-tick JavaScript allocation without introducing pause/removal disconnects.
