# Extension smoke checklist

Build with `npm run build`, load `dist/` as an unpacked extension in the supported Chromium version, and record the browser version and results. Use pages you control for media and Web Audio checks.

## Installation and startup

- [ ] The service worker, popup, isolated content script, and main-world content script load without console errors.
- [ ] The popup opens in normal mode and the toolkit window opens in window mode.
- [ ] Reloading or updating the extension reconnects an already open supported tab.

## Audio behavior

- [ ] Same-origin HTML media remains audible while EQ, gain, mute, reset, Q, high-pass, and low-pass controls work.
- [ ] A permitted cross-origin media source either works or shows the capture error without breaking the page's original audio.
- [ ] Page-created Web Audio remains audible and its graph still works after enable/disable and navigation.
- [ ] A detached `Audio` element works through pause, resume, disable, enable, and reuse of the same element.
- [ ] Navigation and back/forward cache restoration do not duplicate audio processing or leave stale controls.

## Tabs and window mode

- [ ] Two or more captured tabs keep independent filters, gain, mute, and error state.
- [ ] Fast A/B/A tab selection ends with A's latest settings even when storage reads complete out of order.
- [ ] Closing the active captured tab selects a remaining tab; closing an inactive tab preserves the active tab and neighboring stream IDs.
- [ ] Window mode can stop and restart a tab capture; a stop during pending `getUserMedia` stops the late stream.
- [ ] Repeated requests for one stream ID create one capture source.

## Spectrum and persistence

- [ ] Normal popup spectrum frames arrive only for its subscribed tab and source frame, after metadata.
- [ ] Closing the popup stops spectrum demand and sampling; reopening reconnects after service-worker restart.
- [ ] Window mode uses its local spectrum and does not create a second relay analyser.
- [ ] Dragging an EQ point through 100 pointer events schedules at most one draw per animation frame and persists the final immutable filter snapshot.
- [ ] Closing the popup during a drag flushes the final filter snapshot.

## Presets, localization, and accessibility

- [ ] A valid preset JSON imports and round-trips without canvas `x`/`y` coordinates.
- [ ] Invalid JSON, malformed filters, duplicate names, and reserved names do not change storage or the visible preset list.
- [ ] Every available language renders the popup without missing keys or clipped primary controls.
- [ ] At 100% and 200% zoom, controls and dialogs remain usable without hidden actions.
- [ ] Tab, Enter, Space, arrow keys, Home, End, and Escape work for controls, preset menu, dialogs, and canvas editing.
- [ ] Dialog focus is trapped while open and returns to its trigger after close.
- [ ] The equalizer canvas has an accessible name and announces the selected filter and edited value.

Record unsupported CORS or DRM cases as platform limitations with the observed error. Do not mark a scenario passed unless it was exercised in a real browser.
