# Progger UI/UX audit

September 10, 2026. Read-only review of the current local app, including the uncommitted artwork revision. Application code was not edited. Two independent reviewers challenged musical clarity and interface behavior; the main findings were checked against the live browser and source.

The identity is distinctive and worth preserving. The strongest next improvement is making the musical workspace reliable and easy to stay in: keep selections and progression context, make the instrument quicker to reach, and make the expanded catalog easier to navigate.

## Priority order

| Priority | Opportunity | Evidence | Scope |
| --- | --- | --- | --- |
| Fix first | Returning from Chords unexpectedly changes the selected scale to Dorian | Ordinary UI reproduction; step 7 | Targeted state/selector fix |
| Fix first | Comparing another scale discards progression context and the return button | Ordinary UI reproduction; step 4 | Targeted state fix |
| Fix first | Voicing omission labels overflow their row boundaries | Screenshots and measured DOM geometry; step 6 | Targeted layout fix |
| Next | Offer a compact practice layout that brings the neck and its controls together | Measured first-screen geometry; step 1 | Small layout experiment |
| Next | Find voicings near the current fret and on a chosen string set | C13 catalog and Next behavior; step 6 | Focused filtering/ordering |
| Next | Explain what differs between matching scales | Am–D cards and independent musical fixtures; step 3 | Deterministic comparison copy |
| Next | Search long musical menus by names and chord symbols | Current menus and source; step 2 | Shared selector enhancement |
| Later | Restore or share a musical workspace without an account | Source-only review; no reload test | URL state and local display preferences |

## Captured journey

### 1. Open Explore — strong identity, delayed access to the instrument

The pond and typography are cohesive. At the captured 1075 × 828 desktop viewport, the header occupies 520px and the G-flat harmonic-minor neck begins at document y=963px, entirely below the first screen. At 390 × 844, A Dorian's neck begins at y=602px; only part of the instrument fits, and the view/label controls come after it.

Recommend an optional **Practice view** or compact working header after entering the reference area, with root/type, note-versus-degree controls, and the neck visible together. Preserve Proggy's welcome scene and an obvious way to return to it. Do not solve the problem by hiding core controls in more menus.

Source: [app/scene-art.css](</home/jonnyd/Documents/ChatGPT/Progger 2/app/app/scene-art.css>) shared header frames; [app/page.tsx](</home/jonnyd/Documents/ChatGPT/Progger 2/app/app/page.tsx>) reference composition; [components/fretboard.tsx](</home/jonnyd/Documents/ChatGPT/Progger 2/app/components/fretboard.tsx>) instrument toolbar after the diagram.

![Step 1 — desktop Explore](</home/jonnyd/Documents/ChatGPT/Progger 2/app/outputs/ux-audit-2026-09-10/01-explore-desktop.png>)

![Step 1 — mobile Explore](</home/jonnyd/Documents/ChatGPT/Progger 2/app/outputs/ux-audit-2026-09-10/03-explore-mobile.png>)

### 2. Choose a scale — usable grouped menus, weak discovery

Family headings and keyboard focus are useful. The 28-scale menu has no visible search. The chord-quality picker similarly contains 32 named qualities, with chart symbols such as m7b5 absent from the labels. Keyboard Home/Enter successfully selected a root during the audit; the issue is discovery rather than a missing keyboard path.

Add search to the long scale/quality menus, accepting supported aliases and symbols. Keep family groupings and show labels such as **Half-diminished · m7♭5**. Root and fret pickers can remain small, simple menus. Search must never reinterpret an unsupported or ambiguous symbol silently.

Source: [components/music-select.tsx:89](</home/jonnyd/Documents/ChatGPT/Progger 2/app/components/music-select.tsx:89>); [app/page.tsx:487](</home/jonnyd/Documents/ChatGPT/Progger 2/app/app/page.tsx:487>); [components/match-chords.tsx:172](</home/jonnyd/Documents/ChatGPT/Progger 2/app/components/match-chords.tsx:172>).

![Step 2 — grouped scale menu](</home/jonnyd/Documents/ChatGPT/Progger 2/app/outputs/ux-audit-2026-09-10/02-scale-picker.png>)

### 3. Match Am–D — correct coverage, insufficient help choosing

The app recognizes both chords and separates pitch coverage from tonal interpretation. It returns A Dorian, A jazz melodic minor, and A Dorian ♭2. Their explanation is identical: A is the first chord root and therefore one possible center. Beginners still have to compare seven-note lists to discover the actual choice.

Add a short deterministic **What changes** line. For this progression, jazz melodic minor introduces G♯ in place of Dorian's G; Dorian ♭2 introduces B♭ in place of B. Distinguish chord tones from optional melodic notes. Preserve the qualified **Contains all chord tones** wording; avoid turning it into a promise that every note will sound equally settled.

Source: [components/match-chords.tsx:52](</home/jonnyd/Documents/ChatGPT/Progger 2/app/components/match-chords.tsx:52>) and the independently exercised Am–D fixture.

![Step 3 — matching cards repeat the same explanation](</home/jonnyd/Documents/ChatGPT/Progger 2/app/outputs/ux-audit-2026-09-10/04-match-results-mobile.png>)

### 4. Compare another palette — confirmed context loss

Reproduction: enter **Am D** → show **A Dorian** on the neck → choose **Jazz melodic minor** in the scale selector. Before the change, the app displays Am → D, chord-highlight buttons, and **Back to your chords**. Afterward, the progression and both controls disappear. The original typed progression remains available through the top Match navigation, but the comparison workspace is lost.

`choose()` explicitly calls `setContext([])` in [app/page.tsx:179](</home/jonnyd/Documents/ChatGPT/Progger 2/app/app/page.tsx:179>). Preserve context until the existing explicit **Clear context** action. The app already supports explaining chord tones outside the selected palette, so a new scale need not erase the progression. Also preserve the nearest valid pattern starting fret when comparing scales rather than always resetting to index 0.

Related source-only issue: local choices in **Follow each chord** pass only `[chord]` ([components/match-chords.tsx:315](</home/jonnyd/Documents/ChatGPT/Progger 2/app/components/match-chords.tsx:315>)). Preserve the full progression plus the active chord index and label the scale as a local choice, so users can move through the progression deliberately.

![Step 4 — progression context present](</home/jonnyd/Documents/ChatGPT/Progger 2/app/outputs/ux-audit-2026-09-10/05-progression-context.png>)

![Step 4 — context disappears after selecting another scale](</home/jonnyd/Documents/ChatGPT/Progger 2/app/outputs/ux-audit-2026-09-10/06-context-cleared.png>)

### 5. Inspect C13 — musically honest, visually disconnected

The full formula shows C E G B♭ D F A. The first shape correctly plays C B♭ E A and explicitly omits G, D, and F. This distinction is already implemented and should be kept.

Connect the two representations: emphasize sounding notes in the formula and gently mark the omitted ones, with a text explanation that remains available. Avoid deleting notes from the full symbolic chord or relying on color alone. This would help beginners understand why a four-note grip can represent a 13th chord.

Source: [app/page.tsx:503](</home/jonnyd/Documents/ChatGPT/Progger 2/app/app/page.tsx:503>); [components/voicing-browser.tsx:137](</home/jonnyd/Documents/ChatGPT/Progger 2/app/components/voicing-browser.tsx:137>).

![Step 5 — full formula and played notes](</home/jonnyd/Documents/ChatGPT/Progger 2/app/outputs/ux-audit-2026-09-10/07-extended-chord.png>)

### 6. Browse voicings — a confirmed row bug and a navigation opportunity

**Layout defect:** expanded C13 rows measure 60px high on desktop and mobile, while the omission label extends to 73.5px from the row's top. The text falls outside its border, visually colliding with the next row. The list is a 280px scrolling grid; its content has outgrown the original row minimum. Size rows to their content and verify long labels/rootless badges. Do not truncate the omission information.

**Navigation:** C13 has 61 available shapes. The first Next action jumps from frets 8–10 to 20–22; useful low-position shapes appear later. Bass filtering is helpful but insufficient for finding a playable choice near the guitarist's current position.

Add **Near fret…** or distance-based ordering, then optional string-set filters. Keep bass/inversion, rootless, and omission information. Avoid calling a generated voicing “easy” without fingering review. Independent source fixtures also found 72 Cmaj13 shapes, reinforcing the need for navigation rather than more catalog expansion.

Source: [app/night-swim.css:1216](</home/jonnyd/Documents/ChatGPT/Progger 2/app/app/night-swim.css:1216>), [app/night-swim.css:1224](</home/jonnyd/Documents/ChatGPT/Progger 2/app/app/night-swim.css:1224>), [components/voicing-browser.tsx:32](</home/jonnyd/Documents/ChatGPT/Progger 2/app/components/voicing-browser.tsx:32>), [components/voicing-browser.tsx:173](</home/jonnyd/Documents/ChatGPT/Progger 2/app/components/voicing-browser.tsx:173>).

![Step 6 — desktop voicing list](</home/jonnyd/Documents/ChatGPT/Progger 2/app/outputs/ux-audit-2026-09-10/08-voicing-library.png>)

![Step 6 — mobile omission text crosses row borders](</home/jonnyd/Documents/ChatGPT/Progger 2/app/outputs/ux-audit-2026-09-10/09-voicing-library-mobile.png>)

### 7. Return from Chords to Scales — confirmed unexpected selection change

Ordinary UI reproduction: select **G♭ Harmonic minor** → click **Chords** (C13 was retained, and the return label explicitly said Back to G♭ Harmonic minor) → click **Scales & modes**. The app returns to **G♭ Dorian**. This was reproduced through visible controls, independently of the optional browser tool.

The selector should preserve each reference's selected root/type. A likely cause is reusing the same Base UI Select while the option domain changes from 32 chord qualities to 28 scales. The installed SelectPositioner can emit its initial value during option-map changes; Progger forwards all non-null callbacks. The observed fallback, Dorian, matches the selector's initial value. This explains a likely mechanism, not a verified fix.

Investigate selector identity and option-registration lifecycle. Add a focused browser regression for returning from chords to a nondefault scale, plus changing unusual enharmonic roots. Do not broadly ignore programmatic change callbacks: keyboard typeahead/autofill may use them too.

Source: [components/music-select.tsx:56](</home/jonnyd/Documents/ChatGPT/Progger 2/app/components/music-select.tsx:56>); [app/page.tsx:473](</home/jonnyd/Documents/ChatGPT/Progger 2/app/app/page.tsx:473>); installed [SelectPositioner.js:127](</home/jonnyd/Documents/ChatGPT/Progger 2/app/node_modules/@base-ui/react/select/positioner/SelectPositioner.js:127>).

![Step 7 — returning unexpectedly shows Dorian](</home/jonnyd/Documents/ChatGPT/Progger 2/app/outputs/ux-audit-2026-09-10/10-scale-return-reset.png>)

## Additional opportunity: resume and share

Current source stores musical choices in component state and serializes only #explore or #match. A URL does not identify C13, a voicing, or a practice position. Encode shareable musical choices in the URL and retain personal display preferences locally. This can support **Copy this view** and resume without accounts or a library-management feature. This finding is source-backed; the audit did not reload the user's workspace to test persistence.

## Accessibility and limits

Observed strengths: explicit accessible control names, clear keyboard focus, keyboard root selection, text descriptions of note positions, root rings in addition to color, and explicit omission/rootless labels. No horizontal page overflow appeared at the inspected mobile viewport, and no browser console errors were reported.

Risks: omission text is outside the visually indicated row area; secondary text often uses 11–12px sizing; large vertical separation increases scrolling between musical context and instrument. A targeted pass should test enlarged text, long translated labels, screen-reader announcements, and physical touch use.

This was a targeted code and live-flow audit in the in-app Chromium browser, primarily Pond night at desktop and 390px mobile sizes. It was not a full accessibility conformance check, cross-browser matrix, audio-quality review, live production audit, or performance benchmark. Screenshots are from this run. A broken full-page capture was rejected and replaced with a normal viewport capture. No application fixes, commits, or deployments were made.
