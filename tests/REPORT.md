# Pendulum — deep test report: Polyrhythm, Swing, Song Mode

Engine loaded at run time from `index.html (bundled fallback)` via `tests/extract.mjs`,
as expected — `Pendulum_dc.html` is not in the repo. No application source was modified.
UPI was not touched.

Run with `node tests/run.mjs [--failures]`. Leads reproduced with `node tests/leads.mjs`.

## Tally

| Area | Assertions | Passed | Failed | Distinct defects |
|---|--:|--:|--:|--:|
| Polyrhythm | 57,476 | 53,474 | 4,002 | 3 |
| Swing | 11,103 | 11,070 | 33 | 2 (1 is a bad expectation of mine) |
| Song mode (engine) | 630 | 620 | 10 | 6 |
| Song mode (browser) | 172 | 151 | 21 | 6, all confirming the above in the real app |
| pullMet (as shipped) | 414 | 401 | 13 | 4 |
| **Total** | **69,795** | **65,716** | **4,079** | **16** |

A patched re-run of the same 414 `pullMet` assertions (Area 5) passes 409 and fixes all
four defects with nothing newly broken.

The browser suites (`tests/ui/browser.mjs` and `tests/ui/pullmet.mjs`, run with
`node tests/run.mjs --browser --pullmet`) drive `index.html` in Chromium and execute the
paths the pure-engine tests could not reach.

The failure counts are instance counts, not defect counts. Polyrhythm's 4,002 are three
defects enumerated across a 37,440-cell grid.

## The finding that reframes Area 1

**`buildTimeline`'s polyrhythm branch is unreachable in the shipping app, and the
polyrhythm a user can actually hear is produced by completely different code.**

- `buildTimeline` has exactly one call site, `buildSong()` (index.html, `buildSong`).
- No code anywhere sets a `poly` field on a section. `blankSong()`, `addSection()`,
  `loadExample()`, the preset loader and `importSong()` all construct sections
  explicitly and none of them includes `poly`. `grep -n "poly:" ` over the whole
  bundle returns nothing.
- The polyrhythm a user hears comes from `pullMet()`, which runs an independent,
  free-running poly clock: `g.pt += pulseSec(bpm) * y/x` with `g.pn++`, never reset
  at the bar line.

Two consequences, and they point in opposite directions:

1. **Leads 1 and 2 are real defects in `buildTimeline`, but no user can reach them.**
   `pullMet()`'s clock never rounds a note count and never restarts per bar, so it
   cannot produce zero notes and cannot stutter at the bar line. Every silent-ratio
   and bar-line-closure result below describes dead code. That is worth knowing before
   anyone spends a release disabling ratios in the UI.
2. **Polyrhythm is silently dropped the moment Song mode is switched on.** `pull()`
   routes to `pullSong()`, which replays `songEv`; sections carry no `poly`, so
   `buildTimeline` puts no poly events into `songEv` in the first place. Meanwhile
   `polyDots` is computed from `s.polyKey!=='off' && s.polyX>1` with no Song-mode guard,
   so the polyrhythm dot row stays on screen and never lights up. This is the polyrhythm
   bug a user will actually hit, and neither lead mentions it.

   **Correction to an earlier draft of this report:** I first described this as
   `pullSong()` "replaying songEv and nothing else", which implies the player filters poly
   out. It does not. `pullSong()` returns every event in `songEv` verbatim, and `fire()`
   dispatches on `e.k` — `if(e.k==='poly') this.synth(s.polySound, ...)` — as does the
   visual path. **The entire consumption chain already handles poly events coming from a
   song.** The only missing link is that nothing ever writes `poly` onto a section. That
   distinction matters, because it makes the fix far smaller than "wire it through
   pullSong" (see the fix ranking below).

The same holds for two sibling features, and for the same reason: `buildTimeline` reads
`s.pattern` and `s.randomPct` and honours both (proved in Area 1 §1.6, where sections
carrying them mute correctly), but every section-construction site hard-codes
`pattern: null` and none ever writes `randomPct`. So **bar mute patterns and random
silent bars produce nothing in Song mode**, while their panels stay active and editable.
`importSong` is the only path that can set `pattern`, and the UI cannot display or edit
what it sets.

There is no `songMode` guard anywhere on these three panels — `grep -n "songMode"` shows
gating only on the beat-dot view (`songView`) and `paintSong`. The controls remain fully
interactive and silently do nothing.

---

# Area 1: Polyrhythm

## 1.1 Confirmed leads

| Lead | Result |
|---|---|
| 1 — ratios giving <2 notes | **Reproduced exactly.** 2/4 quarter 2:16 → 0; 3/8 dquarter 3:16 → 0; 2/4 quarter 2:3 → 1; 4/4 quarter 2:16 → 1. |
| 2 — 56 of 84 presets do not close | **Reproduced exactly**, at 56/84, derived independently. |

On lead 2 my first pass computed 54, not 56, because I forced quarter notes on 2/2.
Counting each signature in its own denominator note (2/2 in half notes, x/8 in eighths)
gives 56. **The lead was right and my first expected value was wrong.**

## 1.2 Exact characterisation of the silent-ratio bug

Over all 37,440 combinations (15 ratios x-values × 16 y-values × 12 signatures × 13 note
values) the rule is exact, with zero mismatches:

- **Fewer than 2 poly notes ⟺ `ppb·x/y < 1.5`**
- **Zero poly notes ⟺ `ppb·x/y < 0.5`**

3,931 of 37,440 combinations (10.5%) are inaudible; 520 are completely silent.
That is a single expression the UI could use to grey out a ratio, exactly the way
invalid note values are already handled.

**The UI does let a user reach all of them.** `onPolyX` clamps to 2..16 and `onPolyY` to
1..16, so the whole grid is selectable; `polyRatio()` clamps to 2..32 / 1..32.

Worse, one **preset** ratio is inaudible with a **preset** signature at its **default**
note value, requiring no customisation at all:

| Preset ratio | Inaudible in |
|---|---|
| **2:3** | **2/4, 2/2** |

Across preset ratios × preset signatures × all 13 note values, 47 of 1,092 combinations
are inaudible: 2:3 in 23, and 4:3 / 5:4 / 3:4 / 7:8 in 6 each (all at note values that
collapse the bar to a single pulse). 3:2 and 5:3 are safe everywhere.

163 of the 240 selectable ratios are safe in all 12 preset signatures. The 12 that go
fully silent in at least one preset signature are `2:9 2:10 2:11 2:12 2:13 2:14 2:15
2:16 3:13 3:14 3:15 3:16`.

*(All of the above describes `buildTimeline` only — see the reframing section.)*

## 1.3 Note count — where my expectation was wrong, not the app

I first asserted the count should be `ceil(ideal)`, on the grounds that every onset
falling inside the bar ought to sound. That produced 10,269 failures. **The test was
wrong and the app is right.** The arithmetic:

With onsets every `step` seconds and `ideal = barDur/step` of them fitting, choosing `n`
onsets puts the last at `(n-1)·step` and leaves a bar-line gap of `(ideal-n+1)` steps.
Writing `frac` for the fractional part of `ideal`:

- `ceil` → gap `= frac` steps → deviation from an even step `= 1-frac`
- `round` → gap `= 1+frac` steps when `frac<0.5` → deviation `= frac`

For `frac < 0.5`, `frac < 1-frac`, so `round` always leaves the bar line *closer* to an
even step than `ceil` does. Measured over every non-integer combination: **round closes
tighter in 9,749 cases, ties in 13,207, and is never worse.**

Concretely, 4/4 quarter at 120 BPM with 4:3 (`ideal = 5.333`, `step = 0.375s`):
`ceil` → 6 notes, last at 1.875s, a 0.125s gap to the downbeat — an audible flam.
`round` → 5 notes, last at 1.5s, a 0.5s gap — a slight lag. The app's choice is better.

Re-derived correctly as "pick the count from {floor, ceil} that minimises bar-line
deviation", **all 37,440 counts pass**, including all 13,964 exact-fit cases where the
count must be the ideal and the bar line must close perfectly. That sub-assertion passes
everywhere, which is the strongest evidence the poly maths is sound.

## 1.4 Genuine polyrhythm failures

**(a) Inaudible polyrhythm — 3,931 instances.** Covered above.

**(b) Bar-line stutter — 56 instances.** Independently derived and matching lead 2.
Every downbeat aligns exactly (verified at 10, 40, 120, 233.7 and 400 BPM, across all 13
note values, all 7 preset ratios, and with a 60→180 ramp — zero failures), and spacing
inside a bar is exactly even everywhere. Only the gap across the bar line differs.
Worst case is `gap/step = 0.5000` — the note after the bar line arrives twice as soon as
the ear expects. Full ranking in Table B.

**(c) Two accents in a row — 15 instances.** Not previously reported. When the final
poly cycle in a bar is truncated at an accent, that accent is followed immediately by the
next bar's downbeat accent, at a shorter-than-normal gap:

| sig | ratio | gap between the two accents | normal step | ratio |
|---|---|--:|--:|--:|
| 2/2, 2/4, 5/4, 5/8 | 2:3 | 1.000s | 0.750s | 1.333 |
| 4/4, 7/8 | 4:3 | 0.500s | 0.375s | 1.333 |
| 4/4, 7/8 | 2:3 | 0.500s | 0.750s | 0.667 |
| 5/4, 5/8, 9/8 | 5:4 | 0.500s | 0.400s | 1.250 |
| 5/4, 5/8, 9/8 | 3:4 | 0.500s | 0.667s | 0.750 |
| 9/8 | 7:8 | 0.500s | 0.571s | 0.875 |
| 12/8 | 7:8 | (accent pairs, same shape) | | |

The 4/4 2:3 case is the clearest: the accent gap (0.5s) is *shorter* than the poly's own
step (0.75s), so the ear hears a doubled downbeat every bar. Accent placement itself is
correct everywhere — `a === 2` exactly when `pi === 0`, with no exceptions.

## 1.5 What passed

- **Downbeat alignment**: perfect at every tempo, every note value, every preset ratio,
  and under ramps. Zero failures.
- **Even spacing inside a bar**: exact to 1e-12 everywhere.
- **Ramp interaction**: confirmed rather than assumed. Poly spacing tracks each bar's own
  duration (bar duration / ideal, to 1e-12) across a 50→200 BPM ramp over 8 bars of 5/4,
  including the extreme ratios 16:3 and 2:15, and the last poly note never reaches the
  next bar. The lead's belief that this is correct is right, and there is a reason it
  cannot fail: `n = round(ideal) ≤ ideal + 0.5`, so the last onset sits at
  `(n-1)·step ≤ (ideal-0.5)·step < barDur`.
- **Mute agreement**: every poly event on a muted bar is muted, under both a 1-on/1-off
  pattern and 50% random silencing over 24 bars. A single beat muted via state 2
  correctly does *not* silence the independent poly line.
- **Note value interaction** (never tested before, per the brief): 6/8 spans 3 quarter
  notes, giving 2 pulses at dotted quarter, 3 at quarter, 6 at eighth and 12 at
  sixteenth — all confirmed, and 4:3 produces the right count at each.
- **Song mode poly**: per-section ratios, poly on some sections and not others, and the
  seam all behave correctly *in the engine*. This exercises no reachable app path.

---

# Area 2: Swing

## 2.1 The core invariant holds

**Swing never moves the pulses.** Every mode × every integer amount 50–75 × subdivisions
1, 2 and 4, over 4 bars at 132 BPM: every main pulse sits at an exact multiple of the
pulse duration (1e-12) and total bar length is unchanged. Zero failures. Tempo does not
drift while the slider is dragged.

Also passing, with zero failures:

- **Amount 50 is identical to off**, offsets and full timeline, for both 8th and 16th.
- **Slot durations sum to exactly 1** and are strictly positive, across all modes,
  amounts 50–75 in 0.5 steps, subdivisions 1–8.
- **Mismatched subdivision falls back to straight**: `8th` against 1, 3, 4, 5, 6, 7, 8
  and `16th` against 1, 2, 3, 5, 6, 7, 8 — all produce exactly `i/subdiv`.
- **Swing does not reach the polyrhythm.** Verified independently as the lead asked: poly
  onset times are byte-identical with swing off and at amounts 50, 60, 200/3 and 75, for
  all 7 preset ratios. Confirmed — `subOffsets` is only consulted for `sub` events.
- **Swing with ramps.** Over a 60→180 ramp, every offbeat sits at exactly
  `amount% × (that pulse's own duration)`, measured as the distance to the next pulse.
  It is proportional to its own pulse, not an earlier one. Zero failures.
- **Extremes.** Shortest slot at 16th/75%: 25.000 ms at 300 BPM, and 18.750 ms at 400 BPM
  (the app's real ceiling, `clampBpm` max). Both comfortably above 10 ms. 8th/75% gives
  50.000 ms and 37.500 ms.
- **Song mode seam.** A swung section (subdiv 2) next to a non-matching one (subdiv 3)
  next to another swung one: offbeats sit at 75% in the swung sections and at exactly 1/3
  and 2/3 in the straight one, time never runs backwards, there are no duplicate
  timestamps, and no beat is dropped — 22 pulses for 2 bars of 4/4 + 2 of 4/4 + 2 of 3/4.

## 2.2 "67 gives exactly 2:1" — the test is wrong, the app is right

Asserted literally against `subOffsets`, this fails: 67/33 = **2.03030303**, not 2.
Exact 2:1 needs `100 × 2/3 = 66.666…%`.

But the app never passes 67 to `subOffsets`. `swingAmt()` reads
`Math.abs(v-67) < .001 ? 200/3 : v`, with a source comment saying exactly why:
*"Triplet swing is 2:1, i.e. 200/3 %, not 67 — snapping to the exact value keeps the
ratio readout honest while the label still shows a rounded 67%."* The default state is
`swingAmount: 200/3`, and `SWING_SNAPS` includes `200/3`.

**Verdict: the app is correct.** Asserted at the layer the app actually uses (200/3),
2:1 is exact to 1e-12, and 75% gives exactly 3:1, for both 8th and 16th. I left the
literal-67 assertion in and failing, because it documents that `subOffsets` alone does
not have this property — the correctness lives one layer up.

One real inconsistency at that layer: `renderVals()` calls
`subOffsets(sd, s.swingMode, s.swingAmount ?? 67)` — raw state, with a `?? 67` default —
while the audio path calls `swingAmt()`, which applies the snap and defaults to `200/3`.
So the subdivision dots are drawn from a slightly different swing value than the one
being played, and they ignore the in-drag `swingLive` value entirely.

## 2.3 Lead 3 confirmed, and the reachable path narrowed

`subOffsets` has no validation. Reproduced exactly, all 31 failures deliberate:

| amount | offsets | slots | consequence |
|---|---|---|---|
| `NaN` / `undefined` / `"x"` | `[0, NaN]` | `[NaN, NaN]` | 4 of 8 event times NaN |
| `null` / `0` | `[0, 0]` | `[0, 1]` | two notes on one instant, zero-length slot |
| `100` | `[0, 1]` | `[1, 0]` | offbeat lands on the next pulse |
| `120` | `[0, 1.2]` | `[1.2, -0.2]` | offbeat past the end of its own pulse |
| `400` | `[0, 4]` | `[4, -3]` | offbeat four pulses late |
| `-10` | `[0, -0.1]` | `[-0.1, 1.1]` | offbeat before the pulse starts |

**Which paths actually reach it:**

- **localStorage: yes, unclamped.** `swingAmount` is in `PERSIST`. `componentDidMount`
  does `for(const k of PERSIST) if(saved[k]!==undefined) patch[k]=saved[k]`, then
  `migrate()`, which touches `bpmMode`, `noteValue`, `bpm` and `presets` and never looks
  at `swingAmount`. A corrupted value goes straight to `swingAmt()` → `swing()` →
  `subOffsets` → the scheduler. **A poisoned timeline does reach the scheduler; there is
  no clamp on load.**
- **Exported songs: no.** The lead says `swingAmount` "travels in exported songs". It does
  not. `exportSong` writes `{format:'pendulum-song-1', song: this.state.song}` and a song
  is `{name, loop, sections}`; sections carry `subdiv` but no swing. `importSong` sets
  only `song`, never `swingAmount`. **A song carrying `swingAmount: 400` is ignored
  entirely** — I built that case and it has no effect. This half of the lead is wrong.

The fix belongs on load: clamp `swingAmount` to `[SWING_MIN, SWING_MAX]` in `migrate()`,
where the tempo migration already clamps and toasts.

---

# Area 3: Song Mode

## 3.1 What passed

- **Seams.** A 5-section song changing signature, note value, tempo, subdivision and
  accent pattern at every join: no duplicate timestamps within a layer, time never runs
  backwards, exactly one downbeat per bar, bar counter continuous 0..9, sections abut to
  1e-9, and each section's accent pattern survives its seam intact.
- **Duration.** A 20-section song where every section differs in signature, note value,
  tempo, ramp, bar count, subdivision and repeat count matches an independently written
  pulse-by-pulse analytic sum to 1e-9.
- **Repeats and loops nested.** Section repeats 3 and 2 under a whole-song loop of 2:
  16 bars, continuous bar counter, duration matches analytic, and every pulse advances at
  both the repeat boundary and the loop boundary.
- **States resize.** `resizeStates` resizes by index, pads with plain clicks, truncates
  correctly, and always installs a downbeat. Wrong-length arrays handed to
  `buildTimeline` (too short, too long, empty, null) all fall back to a default pattern
  that carries a downbeat.
- **Degenerate sections.** Zero bars → 0 events; negative bars → 0 events (safe);
  1 pulse per bar; 32 pulses per bar (4/4 in 32nds) and 64 (8/4 in 32nds); a section with
  every beat muted keeps its full length and mutes every pulse. All times finite.
- **Random silent bars are indexed by global bar.** Two adjacent 8-bar sections sharing
  seed 42 and 50% silence produce different mute patterns (`00010111` vs `10110000`),
  confirming `silentBar(seed, bar, pct)` is driven by the running global bar counter.
- **The three built-in examples** — Marching show (48 bars), Odd-time riff (10 bars),
  Speed trainer (64 bars) — all build cleanly, pass every structural check, and report
  durations matching the analytic sum to 1e-9. `secDur()` mirrors `buildTimeline`'s
  per-pulse summation exactly, so displayed and actual durations agree for every song the
  UI can build.

## 3.2 Failures

### F1 — Import can set a fractional bar count, and the ramp then overshoots badly

**Severity: high.** Lead 5 asked whether the import path can set a fractional value. It can.

The section editor validates: `bars: Math.max(1, parseInt(v) || 1)`. **`importSong` does
not: `bars: x.bars || 4`.** Any non-zero number survives, fractional or negative.

The rounding itself is mild — `for(let b=0; b<s.bars; b++)` runs `ceil(bars)` times, so
0.5 → 1 bar, 1.7 → 2 bars, 2.0000001 → 3 bars, -1 → 0 bars (safe), all reproduced.
The damage is to the ramp, because `tb = s.bars * ppb` keeps the fractional value while
the loop plays whole bars, so `f = i/(tb-1)` runs past 1:

```
Imported: {bars: 0.5, num: 4, den: 4, bpm: 60, bpmEnd: 120}
  ppb = 4, tb = 0.5*4 = 2, so f = i/(tb-1) = i/1 for i = 0..3
  bpm  = 60 + 60*f  ->  60, 120, 180, 240
```

**A section asked to ramp 60 → 120 plays up to 240 BPM** — double the requested ceiling,
and past `clampBpm`'s 400 limit for larger requests, since `buildTimeline` does not clamp.
`bars: 1.7` overshoots to 132.41 BPM.

*Verdict: app.* Minimal repro in `tests/area3-song.mjs` §3.6.

### F2 — Import can set a negative BPM, producing a timeline that runs backwards

**Severity: high.** `bpm: x.bpm || 120` rejects only falsy values. `bpm: -120` gives
`pulseSec = -0.5`, and a 4-bar section reports **`duration: -8`**. The UI path is safe —
`clampBpm(parseFloat(v) || 120)` bounds it to 10..400.

*Verdict: app.*

### F3 — Import can set `bpmEnd: 0`, producing an infinite timeline

**Severity: high.** `bpmEnd: x.bpmEnd ?? null` — zero is not nullish, so it passes.
The ramp reaches 0 BPM, `pulseSec(0) = Infinity`, and **`duration` is `Infinity`**.
The UI cannot produce this (`clampBpm` floors at 10).

*Verdict: app.*

### F4 — Import can set a fractional subdivision, producing NaN event times

**Severity: high.** `subdiv: x.subdiv || 1` is unvalidated; the editor clamps to an
integer 1..16. With `subdiv: 2.5`:

```
sd = Math.max(1, 2.5) = 2.5
subOffsets: Array.from({length: 2.5}) -> length 2, so offs = [0, 0.4]
buildTimeline: for (j = 1; j < 2.5; j++) -> j = 1, 2; offs[2] is undefined
  -> t + d*undefined = NaN
```

16 of 48 event times are NaN, and the timeline is no longer monotonic:
`[0, 0.2, NaN, 0.5, 0.7, NaN, 1, 1.2, …]`. **This poisons the scheduler.**

*Verdict: app.*

### F5 — A fractional bar count makes the duration readout disagree with what plays

**Severity: medium.** `secDur()` sums `for (let i = 0; i < tb; i++)` with `tb = bars*ppb`,
while `buildTimeline` plays `ceil(bars) * ppb` pulses. For `bars: 1.7, ppb: 4` the readout
sums 6 pulses and the engine plays 8; for `bars: 0.5` it is 2 versus 4. Only reachable
through import, so it rides along with F1.

*Verdict: app.*

### F6 — A ramp restarts on every repeat, with a hard tempo jump (lead 4)

**Severity: low-medium, design.** Reproduced exactly: a 2-bar 60→120 section with
repeat 3 produces three identical passes of `60, 68.6, 77.1, 85.7, 94.3, 102.9, 111.4,
120`. The lead's reading is right — a repeat replays the section — and I have left the
assertion failing because of what it exposes at the boundary: **pulse 7 ends at 120 BPM
and pulse 8 restarts at 60 BPM, a 60 BPM discontinuity**, three times over.

On whether the UI makes it obvious: it does not. The REPEAT field sits in the same
six-field row as BPM and TO BPM with no indication that the ramp is scoped inside it, and
`secDur()` returns `t * (x.repeat || 1)` — a plain multiplication that quietly encodes
"the same ramp, again". A user building a speed ramp with repeats gets a sawtooth, not a
climb, and nothing tells them.

*Verdict: app behaves as designed; the design is unsignposted.*

### F7 — `resizeStates` un-mutes a muted first beat

**Severity: low.** `resizeStates([2,2], 4)` returns `[1,2,0,0]`, not `[2,2,0,0]`: since no
`1` is present, `st[0] = 1` overwrites the muted first beat. **My expectation was wrong
here — the app is right**, because "never leave a bar without an accent" is exactly the
rule the brief asks for, and this is the code that enforces it. Worth noting only as a
side effect: importing a song whose first beat is deliberately muted silently un-mutes and
accents it.

*Verdict: test was wrong; app correct. Recorded as a behavioural note.*

### F8 — `jumpToBar` past the last bar seeks to the start

**Severity: low.** `let i = this.songEv.findIndex(e => e.bar >= n); if (i < 0) i = 0;`
For any `n` at or past the bar count, `findIndex` returns -1 and playback jumps to **bar
0** rather than the end. `mapDown` guards the common case by clamping the tap position to
0.999, so it is reachable only if `songBarCount` is stale relative to `songEv` — after a
section is deleted or reordered and before the rebuild lands. Indexing is otherwise
correct: bars are numbered from 0, `findIndex(e => e.bar >= n)` lands on the first event of
bar `n`, and there is no off-by-one at the first bar.

*Static finding — the seek path needs the DOM and could not be executed here.*

## 3.3 Preset → section conversion drops seven material fields

`savePreset()` stores a 22-key `cfg`. `presetToSection()` reads six of them
(`num`, `den`, `noteValue`, `bpm`, `subdiv`, `states`) plus the preset name, and hard-codes
`pattern: null`. Confirmed live in the browser: a preset saved with every feature switched
on converts to a 12-key section carrying none of them.

```
cfg (22): bpm, countIn, decimals, den, mainSound, mainVol, noteValue, num, patOff,
          patOn, patternKey, polyKey, polySound, polyVol, polyX, polyY, randomPct,
          states, subLabel, subdiv, swingAmount, swingMode
section (12): bars, bpm, bpmEnd, den, id, name, noteValue, num, pattern, repeat,
          states, subdiv
```

Sixteen keys are dropped. They split cleanly in two:

**Seven are a material loss** — `buildTimeline` reads these fields on a section and would
honour them, so the data has somewhere to go and is thrown away:

| cfg keys | section field | what is lost |
|---|---|---|
| `polyKey`, `polyX`, `polyY` | `poly` | the polyrhythm |
| `patternKey`, `patOn`, `patOff` | `pattern` | the bar mute pattern — actively overwritten with `null` |
| `randomPct` | `randomPct` | random silent bars |

**Nine are unrepresentable** — the section schema has no slot for them, and two of those
are global by design rather than by oversight:

- `swingMode`, `swingAmount` — genuinely global; swing is one setting for the whole song.
- `countIn` — a transport setting, not a section property.
- `mainSound`, `polySound`, `mainVol`, `polyVol` — global mixer settings. The preset
  panel implies a preset restores its sounds; converting it to a section quietly cannot.
- `decimals`, `subLabel` — display-only, no behavioural loss.

The three material losses are exactly the three features that are inert in Song mode, so
this is the same defect seen from the other end: the section schema *supports* poly,
pattern and randomPct, and no writer in the app ever populates them.

## 3.4 Minimum fix for each inert feature, ranked

The key finding is that **none of these needs `pullSong` touched**. `buildTimeline` already
emits the events, `pullSong` already replays them, `fire()` already dispatches `k==='poly'`
to the poly synth, and the visual path already paints it. The gap is entirely on the
writer side.

| # | Feature | Minimum fix | Effort | User impact | Verdict |
|---|---|---|---|--:|---|
| 1 | **Bar mute pattern** | Wire it. Add `pattern` to the section editor and stop hard-coding `pattern: null` in `presetToSection`. Engine, player and import already support it. | Lowest — one editor field; `importSong` already passes `x.pattern` through | Medium | **Wire** |
| 2 | **Polyrhythm** | Wire it. Add `poly: {x, y}` to the section object and one editor control; `presetToSection` already has `polyX/polyY` in hand. No player change. | Low — but `buildTimeline`'s poly branch is unproven and carries the three Area 1 defects, so wiring it exposes them | Highest — poly is a headline feature that vanishes | **Wire, but fix the poly branch first** |
| 3 | **Random silent bars** | Wire it. Add `randomPct` (and `seed`) to the section; `buildSong` already injects `seed`. | Low | Low — a practice aid, not a headline | **Wire** |

Guarding the controls instead is cheaper still — one `songMode` check to disable the three
panels with a "not available in Song mode" note — but it is the wrong trade for #1 and #2.
The engine support already exists and is tested; a guard would spend the same UI work to
*remove* a feature users can see. My recommendation:

- **Guard now, wire next**, and only if you need a release today. A disabled control with
  an explanation is strictly better than an enabled one that does nothing, and it is a
  few lines.
- **Otherwise wire #1 and #3 immediately** — they are small, the engine paths are tested
  here, and they carry no known defects.
- **Wire #2 only after fixing the three Area 1 defects**, because turning on
  `buildTimeline`'s poly branch is what would make inaudible ratios, bar-line stutter and
  doubled accents real for the first time. Until then those findings are theoretical;
  wiring poly without fixing them converts all three into live bugs on the same day.

Ranking by effort against impact, **#1 is the best trade** (lowest effort, real impact,
zero known risk), **#2 is the highest impact but gated on prior work**, and **#3 is a
cheap completeness fix**.

## 3.5 Import validation, executed in the browser

The gap flagged in the previous draft is now closed. `tests/ui/browser.mjs` drives
`index.html` in Chromium and imports through the real `<input type="file">`, so
`FileReader`, `JSON.parse`, the `try/catch` and the toast all execute for real. 17 payloads,
168 assertions.

**The three graceful cases all pass**, as the code reading suggested they would:

| payload | result |
|---|---|
| malformed JSON (`{ not json at all`) | rejected, toast *"That file is not a Pendulum song"*, existing song untouched |
| valid JSON that is not a song | same |
| song with zero sections | same |

No uncaught page errors on any payload, and `buildSong()` never throws afterwards.

**Everything else is accepted, and four payloads poison the live timeline.** These are the
same defects F1–F5, now measured on the app's own `songEv` rather than a reconstruction:

| payload | live result |
|---|---|
| `bars: 0.5`, ramp 60→120 | **app schedules up to 240 BPM** — double the requested ceiling |
| `bars: 1.7`, ramp 60→120 | app schedules up to 132.41 BPM |
| `bpm: -120` | `songDur` = **-4 s** |
| `bpmEnd: 0` | `songDur` = **Infinity** |
| `subdiv: 2.5` | **8 of 24 event times are NaN**, timeline non-monotonic |
| `repeat: -2`, `bars: -3`, `loop: -5` | accepted, produce empty or zero-length output (safe) |
| `subdiv: 5000` | accepted, event count bounded, no crash |
| `noteValue: 'dhalf'` in 5/4 | handled correctly — `ppbSafe` falls back to the denominator note |
| 1500 sections × 8 bars | imported cleanly: 48,000 events, 12,000 bars, 24,000 s, all finite and monotonic |

**Export round-trip is exact.** The real download was captured, parsed and re-imported:
`format` tag correct, exported song deep-equals live song, and every section field
(`bars`, `num`, `den`, `noteValue`, `bpm`, `bpmEnd`, `subdiv`, `repeat`, `states`) plus
`loop` survives the round trip unchanged.

**Confirmed: `swingAmount` does not travel in an exported song.** The exported JSON has no
`swingAmount` key, and a song file carrying `swingAmount: 400` is imported with the value
ignored entirely. The lead is wrong on this point.

**Confirmed: localStorage `swingAmount` is not clamped on load, in the running app.**
Seeding `localStorage['pendulm.v1']` before boot and reading what the scheduler actually
uses:

| stored | `swingAmt()` returns | slot durations |
|---|---|---|
| `400` | `400` | `[4, -3]` |
| `-50` | `-50` | `[-0.5, 1.5]` |
| `0` | `0` | `[0, 1]` |
| `"abc"` | `"abc"` | `[NaN, NaN]` |
| `null` | `66.667` | `[0.667, 0.333]` — the `?? 200/3` default catches this one |

Only a nullish value is caught. A poisoned number or string reaches the scheduler intact.

**Confirmed: `jumpToBar` past the last bar seeks to bar 0.** On a 7-bar fixture, ticks 0–6
each land on their own bar exactly — no off-by-one at either end — but tick 7 makes
`findIndex` return -1, which `jumpToBar` converts to index 0.

**Confirmed live: poly and mute do nothing in Song mode.** With `polyKey: 'custom'`,
`polyX: 3`, `polyY: 2`, a 1-on/1-off pattern and 50% random silence all set, and Song mode
on: `polyRatio()` correctly reports `{x: 3, y: 2}`, and the song timeline contains
**0 poly events and 0 muted events**.

## 3.6 Scope still not executed

Audio output itself. Everything above is measured on the event timeline the scheduler
consumes, not on rendered sound. `fire()` and `synth()` were read, not exercised — a
WebAudio-level test would need an offline audio context and is a different piece of work.

---

# Area 4: `pullMet` — the polyrhythm that actually ships

`pullMet()` is stateful, so every test below drives it the way `scheduleAhead()` does:
`resetGen(0)`, then repeated `pull()` calls, asserting on the resulting event stream.
State changes are applied *between* pulls, which is the only way to see what a mid-playback
change does to the poly clock. 398 assertions, `tests/ui/pullmet.mjs`.

The two clocks are independent: `g.t += pulseSec(bpm)` per main pulse, and
`g.pt += pulseSec(bpm) * y/x` per poly note, with `g.pq`/`g.q` one-event queues deciding
which layer emits next. `g.pt` never resnaps to anything.

## 4.1 Drift: none. The concern does not materialise

Over **1,500 bars — 50 minutes of continuous playback** — the poly clock never diverged
from the main clock by a measurable amount:

| ratio | step | worst divergence over 50 min |
|---|---|--:|
| 3:2 | 2/3 pulse (inexact in binary) | 2.5 × 10⁻⁷ ms |
| 4:3 | 3/4 pulse | 0 |
| 7:8 | 8/7 pulse (inexact) | 1.6 × 10⁻⁷ ms |
| 5:4 | 4/5 pulse | 4.1 × 10⁻⁷ ms |

Worst case is **0.4 nanoseconds**. There is a structural reason it cannot grow: `x` steps
of `pulse·y/x` sum to exactly `y` pulses, so the two clocks re-coincide every cycle by
construction, and only IEEE-754 rounding separates them. Accumulated error stays around
10⁻¹³ s because both sums are over the same magnitudes. **Not resnapping to the bar line
costs nothing at constant tempo.** This is the one thing about `pullMet` I would now call
proven safe.

Cycle starts land exactly on main pulses (to 1e-9) for every ratio tested, and accent
placement is exactly right: `a === 2` iff `pi === 0`, no exceptions in 300 events.

## 4.2 A tempo change permanently knocks the poly off the beat — **new defect**

Changing BPM mid-playback: the step correctly follows the new tempo (3:2 at 60 BPM gives
0.6667 s, exactly 2/3 of a 1 s pulse). But the poly cycle never re-coincides with the beat
again. **1 of 12 cycle starts landed on a pulse; every later cycle sits exactly 0.5 s from
the nearest pulse — half a beat off — and stays there, stable to 1.4 × 10⁻¹⁴ s.**

The cause is the look-ahead. `pull()` emits whichever clock is earlier, so at any instant
`g.t` and `g.pt` have advanced to *different* absolute times. A `setState({bpm})` applies
to whatever each clock does next, which is a different musical position for each. The
resulting offset is frozen in, because nothing ever resnaps.

A user nudging the tempo while a polyrhythm plays hears the cross-rhythm slide off the
beat and stay there. This is not in either lead and is the most audible `pullMet` defect.

## 4.3 The poly clock's bar number is recomputed retroactively — **new defect**

```js
const bar = Math.floor((g.pn * r.y / r.x) / this.ppb() + 1e-9);
```

This divides **total elapsed poly steps since the run began** by the **current**
pulses-per-bar. Change the signature or the note value mid-playback and the whole history
is renumbered under the new bar length, while the main clock's `g.bar` is a true running
count. They diverge immediately:

| change | poly notes naming the wrong bar | first offender |
|---|--:|---|
| 4/4 → 3/4 | 36 of 72 | at t=12 s claims bar 8, main clock is in bar 6 |
| quarter → 8th note value | 36 of 72 | at t=12 s claims bar 3, main clock is in bar 6 |
| 6/8 eighth → dotted quarter | 36 of 72 | at t=12 s claims bar 12, main clock is in bar 4 |

Because that number is passed straight to `barMutedAt(bar)`, **the poly layer mutes on the
wrong bars after any signature or note-value change** — the dots and the audio disagree,
which is exactly the failure mode the brief worried about for `buildTimeline`.

## 4.4 `barMutedAt` agreement: correct in steady state

Asked directly: does the poly clock resolve the same bar as the main layer when a poly
note sits near a bar line? **Yes, at constant signature — zero disagreements in 1,556 poly
notes, including 132 that land exactly on a bar line.**

| ratio / signature | poly notes | disagreements | notes exactly on a bar line |
|---|--:|--:|--:|
| 3:2 in 4/4 | 360 | 0 | 60 |
| 4:3 in 4/4 | 343 | 0 | 22 |
| 2:3 in 4/4 | 240 | 0 | 30 |
| 5:4 in 5/4 | 333 | 0 | 14 |
| 7:8 in 7/8 | 280 | 0 | 6 |

The `+ 1e-9` epsilon in the floor is doing real work and is correctly sized: without it,
every one of those 132 on-the-line notes would be a candidate for landing in the previous
bar. The only way to break this is §4.3.

## 4.5 Start, stop, restart: clean. Ratio change: stale phase — **new defect**

`start()` calls `resetGen()`, which rebuilds `g` wholesale. Verified: after a restart
`g.pt`, `g.pn` and `g.t` are all 0 and the first poly note sits exactly on the downbeat.
`stop()` deliberately leaves generator state alone, which is harmless because `start()`
always resets. **No stale phase across stop/start.**

Changing the *ratio* mid-playback is a different story. `componentDidUpdate` does:

```js
if (this.playing && this.g && (p.polyKey !== s.polyKey || p.polyX !== s.polyX || p.polyY !== s.polyY))
  this.g.pn = 0;
```

It resets the step counter but **not `g.pt`**. So the new cycle's accent fires wherever the
old clock happened to be. Interrupting a 3:2 at six different points and switching to 5:4:

| change lands after | new cycle accent | nearest pulse | off by |
|--:|--:|--:|--:|
| 28 pulls | 5.666667 s | 5.5 s | **+167 ms** |
| 29 pulls | 6.000000 s | 6.0 s | 0 |
| 30 pulls | 6.000000 s | 6.0 s | 0 |
| 31 pulls | 6.333333 s | 6.5 s | **−167 ms** |
| 32 pulls | 6.666667 s | 6.5 s | **+167 ms** |
| 33 pulls | 6.666667 s | 6.5 s | **+167 ms** |

**Four of six leave the polyrhythm permanently 167 ms off the beat.** It realigns only when
the change happens to land on a cycle boundary. My first version of this test interrupted
at a single point, hit one of the lucky ones, and passed — a reminder that one sample is
not a test. Setting `g.pt` to the next main pulse alongside `g.pn = 0` would fix it.

## 4.6 `pullMet` versus `buildTimeline`: an exact rule, and a verdict

Same settings, same tempo, six ratio/signature pairs, 6 bars each:

| ratio / signature | bar | cycle | pullMet | buildTimeline | agree? |
|---|--:|--:|--:|--:|---|
| 3:2 in 4/4 | 4 pulses | 2 | 36 notes | 36 notes | **identical** |
| 4:3 in 4/4 | 4 | 3 | 32 | 30 | diverge at bar 1.000 |
| 5:4 in 5/4 | 5 | 4 | 38 | 36 | diverge at bar 1.000 |
| 2:3 in 4/4 | 4 | 3 | 16 | 18 | diverge at bar 1.000 |
| 7:8 in 7/8 | 7 | 8 | 37 | 36 | diverge at bar 1.000 |
| 3:4 in 6/8 | 6 | 4 | 27 | 30 | diverge at bar 1.000 |

**The rule is exact: the two algorithms agree if and only if the cycle length `y` divides
the bar's pulse count, and when they disagree, divergence begins at the first bar line.**
All six "agree iff a cycle tiles the bar" assertions pass.

The shape of the disagreement, 4:3 in 4/4 at 120 BPM:

```
pullMet:       0, 0.375, 0.75, 1.125, 1.5, 1.875, 2.25, 2.625   (even forever)
buildTimeline: 0, 0.375, 0.75, 1.125, 1.5, 2.0,   2.375, 2.75   (jumps to the bar line)
```

Identical through 1.875 s, then `buildTimeline` abandons the grid and restarts on bar 1's
downbeat. Note that `buildTimeline` both *drops* notes (4:3, 5:4, 7:8) and *adds* them
(2:3, 3:4), depending on which way `Math.round` falls.

**`pullMet` is musically right, and it is right by the app's own definition.** The source
comment above `polyRatio()` states it: *"X:Y — X evenly spaced pulses in the time of Y MAIN
pulses. One poly step is therefore (Y/X) main pulses, and one cycle spans exactly Y of
them, sharing the downbeat."* A cycle spanning Y main pulses is a property of the pulse
grid, not of the bar. When Y does not divide the bar, a correct realisation must let the
cycle straddle the bar line — which is precisely what makes a polyrhythm a polyrhythm.
`buildTimeline` re-anchors to the downbeat every bar, which contradicts that definition,
and the bar-line stutter and doubled accents reported in Area 1 are the audible symptoms.

Where they agree — cycle tiles the bar — both are correct. Everywhere else,
`buildTimeline` is wrong and `pullMet` is right. **If poly is ever wired into Song mode,
port `pullMet`'s continuous clock rather than fixing `buildTimeline`'s rounding**; that
supersedes the "fix the poly branch first" caveat in §3.4, and it dissolves leads 1 and 2
instead of patching them, since a continuous clock can neither emit zero notes nor stutter.

---

# Area 5: the `pullMet` fix — design, constraints, and before/after

Written as a diff only. `index.html` is untouched; the patch is applied at run time as an
instance overlay in `tests/ui/pullmet.mjs`, whose method bodies are byte-identical to the
diff below. Both runs execute the same 414 assertions:
`node -e "import('./tests/ui/pullmet.mjs').then(async m => m.runSuite(true))"`.

## 5.1 Results

| | assertions | pass | fail |
|---|--:|--:|--:|
| **Before** (as shipped) | 414 | 401 | 13 |
| **After** (patched) | 414 | 409 | 5 |

**8 fixed, 0 newly broken.**

```
FIXED
  + cycle starts still coincide with main pulses after a tempo change
  + poly bar number matches the main clock across 4/4 -> 3/4
  + poly bar number matches the main clock across quarter -> 8th note value
  + poly bar number matches the main clock across 6/8 eighth -> dotted quarter
  + ratio change after 28 pulls: new cycle starts on a main pulse
  + ratio change after 31 pulls: new cycle starts on a main pulse
  + ratio change after 32 pulls: new cycle starts on a main pulse
  + ratio change after 33 pulls: new cycle starts on a main pulse
STILL FAILING (all five are the buildTimeline comparison, not a pullMet defect)
  = pullMet and buildTimeline agree for 4:3 in 4/4, 5:4 in 5/4, 2:3 in 4/4,
    7:8 in 7/8, 3:4 in 6/8
NEWLY BROKEN
  (none)
```

The five survivors are §4.6: `pullMet` and `buildTimeline` genuinely differ, and `pullMet`
is the correct one. Nothing in this patch should make them agree.

## 5.2 Constraint 1 — steady state is bit-for-bit unchanged

The resnap lives entirely in `componentDidUpdate`. **Not one line of the per-note path
changes**, and `g.pt` keeps the exact expression `pulseSec(s.bpm)*r.y/r.x` — not
refactored to `pulseSec(s.bpm)*stepPulses`, which would round differently and perturb the
accumulation. `g.pt` is never rounded or snapped except on a transition.

Steady run, 4:3 in 4/4, 2,286 poly notes, no edits:

| | before vs after |
|---|---|
| note count | identical |
| timestamps differing | **0 — bit-for-bit identical** |
| bar numbers differing | 0 |
| accents differing | 0 |

The 1,500-bar (50-minute) drift check, identical to the last digit:

| ratio | before (ms) | after (ms) | identical |
|---|--:|--:|:--:|
| 3:2 | 2.478 × 10⁻⁷ | 2.478 × 10⁻⁷ | yes |
| 4:3 | 0 | 0 | yes |
| 7:8 | 1.551 × 10⁻⁷ | 1.551 × 10⁻⁷ | yes |
| 5:4 | 4.088 × 10⁻⁷ | 4.088 × 10⁻⁷ | yes |

A dedicated assertion also checks that the new incremental bar tracker reproduces the
shipped formula `floor((pn*y/x)/ppb + 1e-9)` exactly for all 2,286 notes of a steady run.
It does.

## 5.3 Constraint 2 — the bar formula is fixed independently of the resnap

The formula is wrong with no edit at all, so it is fixed in `pullMet` itself, not by the
resnap. The bar is now tracked incrementally against the ppb **in force when each step was
taken**, and history is never revisited:

```js
g.ppulse += r.y / r.x;
const ppb = this.ppb();
while (g.ppulse >= ppb - 1e-9) { g.ppulse -= ppb; g.pbar++; }
```

`while`, not `if`, because one poly step can span several bars (2:16 in 2/4 steps 8 pulses
at a time). The `-1e-9` mirrors the epsilon already in the shipped formula, which §4.4
proved correctly sized across 132 notes landing exactly on bar lines.

**Proved independent of the resnap.** The signature-change tests run with
`this.playing === false`, so the resnap guard never fires. Instrumented directly:

```
resnapPoly calls: 0      poly notes: 72      wrong bar numbers: 0
```

Baseline on the same scenario was 36 of 72 wrong. The tracker alone fixes it.

## 5.4 Constraint 3 — what happens to a note already in flight

Three tiers, three different fates. Only the middle one is a choice.

| where the note is | fate | why |
|---|---|---|
| **Already scheduled into the audio graph** by `fire()` → `synth()` | **Keeps its original time; it will sound.** | WebAudio nodes are scheduled at absolute times. Recalling them needs oscillator teardown the app has no machinery for anywhere. `scheduleAhead` uses `horizon = ctx.currentTime + .15`, so **the resnap takes audible effect ≤ 150 ms after the edit**; up to that horizon the old phase plays out. |
| **In `this.next`** (pulled, not yet fired) | **Keeps its original time; it will sound.** | `this.next` is always the earliest not-yet-fired event, so `next.t < g.t` always — it is strictly before the resnap point and stays consistent with what follows. |
| **In `g.pq`** (queued, not yet pulled) | **Dropped.** | This is the deliberate choice, and it is load-bearing — see constraint 4. |

Measured at a real bpm edit (3:2, 120 → 60 BPM):

```
g.pq held one note at t = 7.3333   -> dropped
g.pt  7.6667 -> 7.5000 (= g.t, the next main pulse)
first poly notes after the edit: 7.5000, 8.1667, 8.8333   (step 0.6667 s = 2/3 of a 1 s pulse)
```

**Audible outcome: exactly one poly note is skipped at the seam**, leaving a gap of
0.1667 s where it would have fallen, after which the cycle is locked to the beat. The
alternative — rescheduling — would require cancelling already-scheduled audio nodes, which
is a much larger change and is not what any other live edit in this app does.

## 5.5 Constraint 4 — no duplicate timestamp, no backwards emission

**The internal clock does move backwards. The emitted stream never does.** These are
different things and the distinction is the whole justification for clearing `g.pq`.

Tested on 2:16 (one poly note every 8 main pulses), the case where `g.pt` runs far ahead
of `g.t`, interrupting at five points:

```
pulls=10 | pq held [4]  | pq ahead of g.t: false | pt  8.000 ->  4.500 | poly monotonic: true, dupes: false
pulls=14 | pq held [8]  | pq ahead of g.t: TRUE  | pt 12.000 ->  6.000 | poly monotonic: true, dupes: false
pulls=18 | pq held [8]  | pq ahead of g.t: false | pt 12.000 ->  8.000 | poly monotonic: true, dupes: false
pulls=22 | pq held [12] | pq ahead of g.t: TRUE  | pt 16.000 ->  9.500 | poly monotonic: true, dupes: false
pulls=26 | pq held [12] | pq ahead of g.t: TRUE  | pt 16.000 -> 11.500 | poly monotonic: true, dupes: false
```

`g.pt` jumps back by up to 6 seconds, and in 3 of 5 trials the pending note was *later*
than the resnap target. The emitted stream is still strictly increasing with no duplicates
in every trial, because the one note that could have been emitted out of order is the one
that gets dropped.

The counterfactual, same scenario, resnap identical except it keeps the pending note:

```
DROP pending note | poly times [0, 4, 6, 14, 22, 30] | monotonic: true  | duplicates: false
KEEP pending note | poly times [0, 4, 8, 6, 14, 22]  | monotonic: FALSE | duplicates: false
```

Keeping it emits `8` then `6` — **a 2-second backwards jump in the audible stream.**
So: clearing `g.pq` is required, not tidiness.

On duplicates specifically: **no.** Two *poly* notes can never share a timestamp, because
the only candidate was the dropped one. A poly note landing on the same instant as a *main*
pulse is normal and intended (that is what a cycle downbeat is) and already happens
everywhere in steady state. Asserted across every edit scenario: strictly increasing poly
times, zero duplicate poly timestamps, and a full event stream that never runs backwards.

## 5.6 The patch

```diff
--- a/index.html   (Pendulum component)
+++ b/index.html
@@ resetGen
   resetGen(startAt){
     const s=this.state,song=s.song||this.blankSong();
-    this.g={t:startAt,bar:0,beat:0,q:[],pq:[],barMuted:false,countLeft:s.countIn,cbeat:0,pt:startAt,pn:0};
+    // pbar/ppulse track the poly clock's own position in the bar, advanced step by
+    // step so a later signature change cannot renumber history retroactively.
+    this.g={t:startAt,bar:0,beat:0,q:[],pq:[],barMuted:false,countLeft:s.countIn,cbeat:0,
+            pt:startAt,pn:0,pbar:0,ppulse:0};
     this.passesLeft=song.loop===0?Infinity:(song.loop||1);

+@@ new method, next to resetGen
+  // Re-phase the poly clock onto the main grid after a live edit. Runs ONCE per
+  // transition and never per note, so steady-state accumulation is untouched.
+  // Clearing pq is load-bearing: the pending note can be LATER than the resnap
+  // target when the poly step is long, and emitting it would run the stream backwards.
+  resnapPoly(resetCycle){
+    const g=this.g;
+    if(!g) return;
+    g.pq.length=0;
+    g.pt=g.t;                                  // g.t is the next main pulse not yet queued
+    const ppb=this.ppb(),wrap=g.beat>=ppb;
+    g.pbar=wrap?g.bar+1:g.bar;
+    g.ppulse=wrap?0:g.beat;
+    if(resetCycle) g.pn=0;
+  }

@@ pullMet, poly branch  (the main branch is unchanged)
     const r=this.polyRatio();
     if(r&&!g.pq.length){
       const pos=g.pn%r.x;
-      // Elapsed main pulses on the poly clock, used only to name the bar for muting.
-      const bar=Math.floor((g.pn*r.y/r.x)/this.ppb()+1e-9);
+      // The bar this note falls in, tracked incrementally. The old form divided TOTAL
+      // elapsed steps by the CURRENT ppb, so a signature change renumbered the past.
+      const bar=g.pbar;
       g.pq.push({t:g.pt,k:'poly',a:pos===0?2:0,bar,pi:pos,cyc:Math.floor(g.pn/r.x),
         muted:this.barMutedAt(bar)});
-      g.pt+=pulseSec(s.bpm)*r.y/r.x;
+      g.pt+=pulseSec(s.bpm)*r.y/r.x;           // expression untouched: same rounding
+      g.ppulse+=r.y/r.x;
+      const ppb=this.ppb();
+      while(g.ppulse>=ppb-1e-9){g.ppulse-=ppb;g.pbar++;}   // while: one step can span bars
       g.pn++;
     }

@@ componentDidUpdate
-    // Re-phase the poly cycle so a ratio change lands on a cycle start rather than mid-cycle.
-    if(this.playing&&this.g&&(p.polyKey!==s.polyKey||p.polyX!==s.polyX||p.polyY!==s.polyY)) this.g.pn=0;
+    // Re-phase the poly cycle so a live edit lands on a cycle start rather than mid-cycle.
+    // Any change to the pulse grid counts, not just the ratio: tempo, signature and note
+    // value all move the grid the poly clock is supposed to be locked to.
+    {
+      const gridChanged=p.bpm!==s.bpm||p.num!==s.num||p.den!==s.den||p.noteValue!==s.noteValue;
+      const ratioChanged=p.polyKey!==s.polyKey||p.polyX!==s.polyX||p.polyY!==s.polyY;
+      if(this.playing&&this.g&&(gridChanged||ratioChanged)) this.resnapPoly(ratioChanged);
+    }
     this._prev={theme:s.theme,bpm:s.bpm,masterVol:s.masterVol,accent:this.props.accent,
       swingAmount:s.swingAmount,swingMode:s.swingMode,subdiv:s.subdiv,panel:s.panel,
-      polyKey:s.polyKey,polyX:s.polyX,polyY:s.polyY};
+      polyKey:s.polyKey,polyX:s.polyX,polyY:s.polyY,
+      num:s.num,den:s.den,noteValue:s.noteValue};
```

`num`, `den` and `noteValue` must be added to `_prev` — it does not track them today, so
without that line the signature branch of `gridChanged` can never fire.

## 5.7 What the patch does not do

- It does not touch `buildTimeline`. §4.6 stands: if poly is ever wired into Song mode,
  port this clock rather than repairing the per-bar restart.
- It does not cancel already-scheduled audio. The old phase plays out for up to 150 ms
  after an edit (§5.4). Removing that would mean tearing down scheduled oscillators.
- It does not clamp or validate anything. The `importSong` gap (§3.5) is untouched.
- It leaves one poly note skipped at each edit seam. That is the cost of not rescheduling,
  and it is the quietest of the three options.

---

# Severity ranking, by what a user would actually notice

| # | Finding | Who hits it | Notice |
|---|---|---|---|
| 1 | **Polyrhythm silently dropped in Song mode**, dots still displayed, controls still enabled | anyone using both features | Immediate. Confirmed live: 0 poly events with poly switched on. |
| 2 | **Imported fractional `bars` → ramp overshoots to 2× the target tempo** (F1) | anyone importing a shared song | Loud. Confirmed live: a 60→120 section schedules 240 BPM. |
| 3 | **Imported fractional `subdiv` → NaN event times** (F4) | same | Loud. Confirmed live: 8 of 24 event times NaN. |
| 4 | **Imported `bpmEnd: 0` → infinite duration** (F3) | same | Playback stalls. Confirmed live. |
| 5 | **Imported negative `bpm` → negative duration** (F2) | same | Playback broken. Confirmed live. |
| 6 | **Mute patterns and random silent bars inert in Song mode** | anyone using both | Immediate, same shape as #1. Confirmed live: 0 muted events. |
| 6a | **Tempo change knocks the live polyrhythm permanently half a beat off** (§4.2) | anyone nudging BPM while poly plays | Loud and lasting. The cross-rhythm slides off the beat and stays there. |
| 6b | **Ratio change mid-playback leaves the poly 167 ms off the beat** (§4.5) | anyone switching ratio while playing | Loud; 4 of 6 interruption points. |
| 6c | **Signature/note-value change makes the live poly mute on the wrong bars** (§4.3) | poly + mute pattern + a mid-run signature change | Dots and audio disagree. |
| 7 | **Corrupted localStorage `swingAmount` reaches the scheduler unclamped** (lead 3) | rare; needs corrupted storage | Confirmed live: `"abc"` → NaN slots. Unrecoverable from the UI. |
| 8 | **`presetToSection` drops poly, pattern and randomPct** | anyone converting a preset to a section | Silent. The preset's rhythm settings vanish with no warning. |
| 9 | **Ramp restarts per repeat with a 60 BPM jump, unsignposted** (F6) | anyone using repeats with ramps | Audible sawtooth; likely read as a bug. |
| 10 | **Duration readout disagrees with playback for fractional bars** (F5) | import only | Wrong time shown. |
| 11 | **Two poly accents in a row** (Area 1c) | nobody today — dead code | Would be a doubled downbeat if the branch were wired up. |
| 12 | **Inaudible / silent poly ratios, bar-line stutter** (leads 1, 2) | nobody today — dead code | High if `buildTimeline`'s poly is ever used. |
| 13 | **Swing dots drawn from a different value than the audio** | anyone dragging the slider | Dots lag the finger; cosmetic. |
| 14 | **`jumpToBar` past the end seeks to bar 0** (F8) | narrow race | Confirmed live; one wrong jump. |

Items 2–5 share one root cause and one fix: **`importSong` validates `noteValue` and
`states` and nothing else, while the section editor beside it validates every field.**
Reusing the editor's own validators in the importer closes four of the top five.

---

# Which areas I consider proven

**Swing — proven.** 11,103 engine assertions plus the browser checks. The core invariant
that swing never moves the pulses holds exactly across every mode, every amount 50–75 and
subdivisions 1–8. Ratios are exact at the layer the app uses, the straight-subdivision
fallback is exhaustively correct, ramps scale each offbeat to its own pulse, swing is
provably isolated from the polyrhythm, and the shortest slot at the app's true 400 BPM
ceiling is 18.75 ms. The one real defect — no clamp on load — is now confirmed in the
running app rather than inferred, and is a one-line fix in `migrate()`.

**Polyrhythm — now tested on both paths, and they are not equally good.**

`buildTimeline`'s poly arithmetic is internally sound — downbeat alignment, in-bar
spacing, ramp tracking and mute agreement all exact, note count optimal in all 37,440
cases — but its per-bar restart contradicts the app's own definition of X:Y, and its three
defects (inaudible ratios, bar-line stutter, doubled accents) all follow from that restart.
It remains unreachable by any user.

`pullMet` — the one that ships — is now tested for the first time: 398 assertions across
50-minute runs. **Its steady state is excellent.** No measurable drift (0.4 ns over
1,500 bars), cycle starts exactly on pulses, accents exactly right, mute agreement perfect
across 1,556 poly notes including 132 on bar lines, and clean reset on restart. The free
clock costs nothing at constant tempo.

**Every one of its four defects is triggered by a mid-playback change**, and none was known
before: a tempo change knocks the cycle permanently half a beat off (§4.2); a ratio change
leaves it 167 ms off in 4 of 6 cases (§4.5); a signature or note-value change makes the
poly bar number retroactively wrong and mutes the wrong bars (§4.3).

Area 5 designs and verifies the fix. Two defects, two separate causes: the bar formula is
wrong on its own and is repaired inside `pullMet` with an incremental tracker (proved to
work with the resnap disabled), while the phase defects are repaired by a resnap that runs
once per transition in `componentDidUpdate` and never touches the per-note path. Measured
before and after on the same 414 assertions: **401 → 409 passing, 8 fixed, 0 newly broken,
and steady state bit-for-bit identical including the 50-minute drift figures.**

So: **steady-state polyrhythm was already proven correct, polyrhythm under live edits was
proven broken, and the fix is now proven not to cost anything in steady state.**

**Song mode — now proven, with one named exception.** This is the change from the first
pass. 630 engine assertions plus 172 browser assertions covering the paths I previously
could not execute: import through the real `FileReader`, the real export download and
round trip, localStorage rehydration and the bar-map seek. Structure was already solid —
seams, durations, bar counting, repeats, loops, degenerate sections, seeded silence, the
three examples. What is now also proven is the failure side: malformed JSON, non-song
JSON and zero-section songs are all rejected gracefully with a message and leave the
loaded song untouched; export round-trips exactly; a 1500-section song imports cleanly.

The exception is not coverage but correctness: **`importSong` remains the single weakest
surface in the app**, accepting six classes of value the section editor rejects, four of
which poison the live timeline. I would call Song mode proven as *tested* and not yet
*correct*. Bring `importSong` up to the editor's standard and the area is done.

The one thing still unexecuted anywhere is audio output itself — every result here is
measured on the event timeline the scheduler consumes, not on rendered sound.

---

# Table A — polyrhythm note count per bar, by ratio and signature

Each signature counted at its own denominator note (2/2 in half notes, x/8 in eighths).
Counts in **bold** are fewer than 2, i.e. the polyrhythm is inaudible. All 240
user-selectable ratios (x = 2..16, y = 1..16) are listed.

| ratio | 2/2 | 2/4 | 3/4 | 4/4 | 5/4 | 6/4 | 3/8 | 5/8 | 6/8 | 7/8 | 9/8 | 12/8 |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 2:1 | 4 | 4 | 6 | 8 | 10 | 12 | 6 | 10 | 12 | 14 | 18 | 24 |
| 2:2 | 2 | 2 | 3 | 4 | 5 | 6 | 3 | 5 | 6 | 7 | 9 | 12 |
| 2:3 | **1** | **1** | 2 | 3 | 3 | 4 | 2 | 3 | 4 | 5 | 6 | 8 |
| 2:4 | **1** | **1** | 2 | 2 | 3 | 3 | 2 | 3 | 3 | 4 | 5 | 6 |
| 2:5 | **1** | **1** | **1** | 2 | 2 | 2 | **1** | 2 | 2 | 3 | 4 | 5 |
| 2:6 | **1** | **1** | **1** | **1** | 2 | 2 | **1** | 2 | 2 | 2 | 3 | 4 |
| 2:7 | **1** | **1** | **1** | **1** | **1** | 2 | **1** | **1** | 2 | 2 | 3 | 3 |
| 2:8 | **1** | **1** | **1** | **1** | **1** | 2 | **1** | **1** | 2 | 2 | 2 | 3 |
| 2:9 | **0** | **0** | **1** | **1** | **1** | **1** | **1** | **1** | **1** | 2 | 2 | 3 |
| 2:10 | **0** | **0** | **1** | **1** | **1** | **1** | **1** | **1** | **1** | **1** | 2 | 2 |
| 2:11 | **0** | **0** | **1** | **1** | **1** | **1** | **1** | **1** | **1** | **1** | 2 | 2 |
| 2:12 | **0** | **0** | **1** | **1** | **1** | **1** | **1** | **1** | **1** | **1** | 2 | 2 |
| 2:13 | **0** | **0** | **0** | **1** | **1** | **1** | **0** | **1** | **1** | **1** | **1** | 2 |
| 2:14 | **0** | **0** | **0** | **1** | **1** | **1** | **0** | **1** | **1** | **1** | **1** | 2 |
| 2:15 | **0** | **0** | **0** | **1** | **1** | **1** | **0** | **1** | **1** | **1** | **1** | 2 |
| 2:16 | **0** | **0** | **0** | **1** | **1** | **1** | **0** | **1** | **1** | **1** | **1** | 2 |
| 3:1 | 6 | 6 | 9 | 12 | 15 | 18 | 9 | 15 | 18 | 21 | 27 | 36 |
| 3:2 | 3 | 3 | 5 | 6 | 8 | 9 | 5 | 8 | 9 | 11 | 14 | 18 |
| 3:3 | 2 | 2 | 3 | 4 | 5 | 6 | 3 | 5 | 6 | 7 | 9 | 12 |
| 3:4 | 2 | 2 | 2 | 3 | 4 | 5 | 2 | 4 | 5 | 5 | 7 | 9 |
| 3:5 | **1** | **1** | 2 | 2 | 3 | 4 | 2 | 3 | 4 | 4 | 5 | 7 |
| 3:6 | **1** | **1** | 2 | 2 | 3 | 3 | 2 | 3 | 3 | 4 | 5 | 6 |
| 3:7 | **1** | **1** | **1** | 2 | 2 | 3 | **1** | 2 | 3 | 3 | 4 | 5 |
| 3:8 | **1** | **1** | **1** | 2 | 2 | 2 | **1** | 2 | 2 | 3 | 3 | 5 |
| 3:9 | **1** | **1** | **1** | **1** | 2 | 2 | **1** | 2 | 2 | 2 | 3 | 4 |
| 3:10 | **1** | **1** | **1** | **1** | 2 | 2 | **1** | 2 | 2 | 2 | 3 | 4 |
| 3:11 | **1** | **1** | **1** | **1** | **1** | 2 | **1** | **1** | 2 | 2 | 2 | 3 |
| 3:12 | **1** | **1** | **1** | **1** | **1** | 2 | **1** | **1** | 2 | 2 | 2 | 3 |
| 3:13 | **0** | **0** | **1** | **1** | **1** | **1** | **1** | **1** | **1** | 2 | 2 | 3 |
| 3:14 | **0** | **0** | **1** | **1** | **1** | **1** | **1** | **1** | **1** | 2 | 2 | 3 |
| 3:15 | **0** | **0** | **1** | **1** | **1** | **1** | **1** | **1** | **1** | **1** | 2 | 2 |
| 3:16 | **0** | **0** | **1** | **1** | **1** | **1** | **1** | **1** | **1** | **1** | 2 | 2 |
| 4:1 | 8 | 8 | 12 | 16 | 20 | 24 | 12 | 20 | 24 | 28 | 36 | 48 |
| 4:2 | 4 | 4 | 6 | 8 | 10 | 12 | 6 | 10 | 12 | 14 | 18 | 24 |
| 4:3 | 3 | 3 | 4 | 5 | 7 | 8 | 4 | 7 | 8 | 9 | 12 | 16 |
| 4:4 | 2 | 2 | 3 | 4 | 5 | 6 | 3 | 5 | 6 | 7 | 9 | 12 |
| 4:5 | 2 | 2 | 2 | 3 | 4 | 5 | 2 | 4 | 5 | 6 | 7 | 10 |
| 4:6 | **1** | **1** | 2 | 3 | 3 | 4 | 2 | 3 | 4 | 5 | 6 | 8 |
| 4:7 | **1** | **1** | 2 | 2 | 3 | 3 | 2 | 3 | 3 | 4 | 5 | 7 |
| 4:8 | **1** | **1** | 2 | 2 | 3 | 3 | 2 | 3 | 3 | 4 | 5 | 6 |
| 4:9 | **1** | **1** | **1** | 2 | 2 | 3 | **1** | 2 | 3 | 3 | 4 | 5 |
| 4:10 | **1** | **1** | **1** | 2 | 2 | 2 | **1** | 2 | 2 | 3 | 4 | 5 |
| 4:11 | **1** | **1** | **1** | **1** | 2 | 2 | **1** | 2 | 2 | 3 | 3 | 4 |
| 4:12 | **1** | **1** | **1** | **1** | 2 | 2 | **1** | 2 | 2 | 2 | 3 | 4 |
| 4:13 | **1** | **1** | **1** | **1** | 2 | 2 | **1** | 2 | 2 | 2 | 3 | 4 |
| 4:14 | **1** | **1** | **1** | **1** | **1** | 2 | **1** | **1** | 2 | 2 | 3 | 3 |
| 4:15 | **1** | **1** | **1** | **1** | **1** | 2 | **1** | **1** | 2 | 2 | 2 | 3 |
| 4:16 | **1** | **1** | **1** | **1** | **1** | 2 | **1** | **1** | 2 | 2 | 2 | 3 |
| 5:1 | 10 | 10 | 15 | 20 | 25 | 30 | 15 | 25 | 30 | 35 | 45 | 60 |
| 5:2 | 5 | 5 | 8 | 10 | 13 | 15 | 8 | 13 | 15 | 18 | 23 | 30 |
| 5:3 | 3 | 3 | 5 | 7 | 8 | 10 | 5 | 8 | 10 | 12 | 15 | 20 |
| 5:4 | 3 | 3 | 4 | 5 | 6 | 8 | 4 | 6 | 8 | 9 | 11 | 15 |
| 5:5 | 2 | 2 | 3 | 4 | 5 | 6 | 3 | 5 | 6 | 7 | 9 | 12 |
| 5:6 | 2 | 2 | 3 | 3 | 4 | 5 | 3 | 4 | 5 | 6 | 8 | 10 |
| 5:7 | **1** | **1** | 2 | 3 | 4 | 4 | 2 | 4 | 4 | 5 | 6 | 9 |
| 5:8 | **1** | **1** | 2 | 3 | 3 | 4 | 2 | 3 | 4 | 4 | 6 | 8 |
| 5:9 | **1** | **1** | 2 | 2 | 3 | 3 | 2 | 3 | 3 | 4 | 5 | 7 |
| 5:10 | **1** | **1** | 2 | 2 | 3 | 3 | 2 | 3 | 3 | 4 | 5 | 6 |
| 5:11 | **1** | **1** | **1** | 2 | 2 | 3 | **1** | 2 | 3 | 3 | 4 | 5 |
| 5:12 | **1** | **1** | **1** | 2 | 2 | 3 | **1** | 2 | 3 | 3 | 4 | 5 |
| 5:13 | **1** | **1** | **1** | 2 | 2 | 2 | **1** | 2 | 2 | 3 | 3 | 5 |
| 5:14 | **1** | **1** | **1** | **1** | 2 | 2 | **1** | 2 | 2 | 3 | 3 | 4 |
| 5:15 | **1** | **1** | **1** | **1** | 2 | 2 | **1** | 2 | 2 | 2 | 3 | 4 |
| 5:16 | **1** | **1** | **1** | **1** | 2 | 2 | **1** | 2 | 2 | 2 | 3 | 4 |
| 6:1 | 12 | 12 | 18 | 24 | 30 | 36 | 18 | 30 | 36 | 42 | 54 | 72 |
| 6:2 | 6 | 6 | 9 | 12 | 15 | 18 | 9 | 15 | 18 | 21 | 27 | 36 |
| 6:3 | 4 | 4 | 6 | 8 | 10 | 12 | 6 | 10 | 12 | 14 | 18 | 24 |
| 6:4 | 3 | 3 | 5 | 6 | 8 | 9 | 5 | 8 | 9 | 11 | 14 | 18 |
| 6:5 | 2 | 2 | 4 | 5 | 6 | 7 | 4 | 6 | 7 | 8 | 11 | 14 |
| 6:6 | 2 | 2 | 3 | 4 | 5 | 6 | 3 | 5 | 6 | 7 | 9 | 12 |
| 6:7 | 2 | 2 | 3 | 3 | 4 | 5 | 3 | 4 | 5 | 6 | 8 | 10 |
| 6:8 | 2 | 2 | 2 | 3 | 4 | 5 | 2 | 4 | 5 | 5 | 7 | 9 |
| 6:9 | **1** | **1** | 2 | 3 | 3 | 4 | 2 | 3 | 4 | 5 | 6 | 8 |
| 6:10 | **1** | **1** | 2 | 2 | 3 | 4 | 2 | 3 | 4 | 4 | 5 | 7 |
| 6:11 | **1** | **1** | 2 | 2 | 3 | 3 | 2 | 3 | 3 | 4 | 5 | 7 |
| 6:12 | **1** | **1** | 2 | 2 | 3 | 3 | 2 | 3 | 3 | 4 | 5 | 6 |
| 6:13 | **1** | **1** | **1** | 2 | 2 | 3 | **1** | 2 | 3 | 3 | 4 | 6 |
| 6:14 | **1** | **1** | **1** | 2 | 2 | 3 | **1** | 2 | 3 | 3 | 4 | 5 |
| 6:15 | **1** | **1** | **1** | 2 | 2 | 2 | **1** | 2 | 2 | 3 | 4 | 5 |
| 6:16 | **1** | **1** | **1** | 2 | 2 | 2 | **1** | 2 | 2 | 3 | 3 | 5 |
| 7:1 | 14 | 14 | 21 | 28 | 35 | 42 | 21 | 35 | 42 | 49 | 63 | 84 |
| 7:2 | 7 | 7 | 11 | 14 | 18 | 21 | 11 | 18 | 21 | 25 | 32 | 42 |
| 7:3 | 5 | 5 | 7 | 9 | 12 | 14 | 7 | 12 | 14 | 16 | 21 | 28 |
| 7:4 | 4 | 4 | 5 | 7 | 9 | 11 | 5 | 9 | 11 | 12 | 16 | 21 |
| 7:5 | 3 | 3 | 4 | 6 | 7 | 8 | 4 | 7 | 8 | 10 | 13 | 17 |
| 7:6 | 2 | 2 | 4 | 5 | 6 | 7 | 4 | 6 | 7 | 8 | 11 | 14 |
| 7:7 | 2 | 2 | 3 | 4 | 5 | 6 | 3 | 5 | 6 | 7 | 9 | 12 |
| 7:8 | 2 | 2 | 3 | 4 | 4 | 5 | 3 | 4 | 5 | 6 | 8 | 11 |
| 7:9 | 2 | 2 | 2 | 3 | 4 | 5 | 2 | 4 | 5 | 5 | 7 | 9 |
| 7:10 | **1** | **1** | 2 | 3 | 4 | 4 | 2 | 4 | 4 | 5 | 6 | 8 |
| 7:11 | **1** | **1** | 2 | 3 | 3 | 4 | 2 | 3 | 4 | 4 | 6 | 8 |
| 7:12 | **1** | **1** | 2 | 2 | 3 | 4 | 2 | 3 | 4 | 4 | 5 | 7 |
| 7:13 | **1** | **1** | 2 | 2 | 3 | 3 | 2 | 3 | 3 | 4 | 5 | 6 |
| 7:14 | **1** | **1** | 2 | 2 | 3 | 3 | 2 | 3 | 3 | 4 | 5 | 6 |
| 7:15 | **1** | **1** | **1** | 2 | 2 | 3 | **1** | 2 | 3 | 3 | 4 | 6 |
| 7:16 | **1** | **1** | **1** | 2 | 2 | 3 | **1** | 2 | 3 | 3 | 4 | 5 |
| 8:1 | 16 | 16 | 24 | 32 | 40 | 48 | 24 | 40 | 48 | 56 | 72 | 96 |
| 8:2 | 8 | 8 | 12 | 16 | 20 | 24 | 12 | 20 | 24 | 28 | 36 | 48 |
| 8:3 | 5 | 5 | 8 | 11 | 13 | 16 | 8 | 13 | 16 | 19 | 24 | 32 |
| 8:4 | 4 | 4 | 6 | 8 | 10 | 12 | 6 | 10 | 12 | 14 | 18 | 24 |
| 8:5 | 3 | 3 | 5 | 6 | 8 | 10 | 5 | 8 | 10 | 11 | 14 | 19 |
| 8:6 | 3 | 3 | 4 | 5 | 7 | 8 | 4 | 7 | 8 | 9 | 12 | 16 |
| 8:7 | 2 | 2 | 3 | 5 | 6 | 7 | 3 | 6 | 7 | 8 | 10 | 14 |
| 8:8 | 2 | 2 | 3 | 4 | 5 | 6 | 3 | 5 | 6 | 7 | 9 | 12 |
| 8:9 | 2 | 2 | 3 | 4 | 4 | 5 | 3 | 4 | 5 | 6 | 8 | 11 |
| 8:10 | 2 | 2 | 2 | 3 | 4 | 5 | 2 | 4 | 5 | 6 | 7 | 10 |
| 8:11 | **1** | **1** | 2 | 3 | 4 | 4 | 2 | 4 | 4 | 5 | 7 | 9 |
| 8:12 | **1** | **1** | 2 | 3 | 3 | 4 | 2 | 3 | 4 | 5 | 6 | 8 |
| 8:13 | **1** | **1** | 2 | 2 | 3 | 4 | 2 | 3 | 4 | 4 | 6 | 7 |
| 8:14 | **1** | **1** | 2 | 2 | 3 | 3 | 2 | 3 | 3 | 4 | 5 | 7 |
| 8:15 | **1** | **1** | 2 | 2 | 3 | 3 | 2 | 3 | 3 | 4 | 5 | 6 |
| 8:16 | **1** | **1** | 2 | 2 | 3 | 3 | 2 | 3 | 3 | 4 | 5 | 6 |
| 9:1 | 18 | 18 | 27 | 36 | 45 | 54 | 27 | 45 | 54 | 63 | 81 | 108 |
| 9:2 | 9 | 9 | 14 | 18 | 23 | 27 | 14 | 23 | 27 | 32 | 41 | 54 |
| 9:3 | 6 | 6 | 9 | 12 | 15 | 18 | 9 | 15 | 18 | 21 | 27 | 36 |
| 9:4 | 5 | 5 | 7 | 9 | 11 | 14 | 7 | 11 | 14 | 16 | 20 | 27 |
| 9:5 | 4 | 4 | 5 | 7 | 9 | 11 | 5 | 9 | 11 | 13 | 16 | 22 |
| 9:6 | 3 | 3 | 5 | 6 | 8 | 9 | 5 | 8 | 9 | 11 | 14 | 18 |
| 9:7 | 3 | 3 | 4 | 5 | 6 | 8 | 4 | 6 | 8 | 9 | 12 | 15 |
| 9:8 | 2 | 2 | 3 | 5 | 6 | 7 | 3 | 6 | 7 | 8 | 10 | 14 |
| 9:9 | 2 | 2 | 3 | 4 | 5 | 6 | 3 | 5 | 6 | 7 | 9 | 12 |
| 9:10 | 2 | 2 | 3 | 4 | 5 | 5 | 3 | 5 | 5 | 6 | 8 | 11 |
| 9:11 | 2 | 2 | 2 | 3 | 4 | 5 | 2 | 4 | 5 | 6 | 7 | 10 |
| 9:12 | 2 | 2 | 2 | 3 | 4 | 5 | 2 | 4 | 5 | 5 | 7 | 9 |
| 9:13 | **1** | **1** | 2 | 3 | 3 | 4 | 2 | 3 | 4 | 5 | 6 | 8 |
| 9:14 | **1** | **1** | 2 | 3 | 3 | 4 | 2 | 3 | 4 | 5 | 6 | 8 |
| 9:15 | **1** | **1** | 2 | 2 | 3 | 4 | 2 | 3 | 4 | 4 | 5 | 7 |
| 9:16 | **1** | **1** | 2 | 2 | 3 | 3 | 2 | 3 | 3 | 4 | 5 | 7 |
| 10:1 | 20 | 20 | 30 | 40 | 50 | 60 | 30 | 50 | 60 | 70 | 90 | 120 |
| 10:2 | 10 | 10 | 15 | 20 | 25 | 30 | 15 | 25 | 30 | 35 | 45 | 60 |
| 10:3 | 7 | 7 | 10 | 13 | 17 | 20 | 10 | 17 | 20 | 23 | 30 | 40 |
| 10:4 | 5 | 5 | 8 | 10 | 13 | 15 | 8 | 13 | 15 | 18 | 23 | 30 |
| 10:5 | 4 | 4 | 6 | 8 | 10 | 12 | 6 | 10 | 12 | 14 | 18 | 24 |
| 10:6 | 3 | 3 | 5 | 7 | 8 | 10 | 5 | 8 | 10 | 12 | 15 | 20 |
| 10:7 | 3 | 3 | 4 | 6 | 7 | 9 | 4 | 7 | 9 | 10 | 13 | 17 |
| 10:8 | 3 | 3 | 4 | 5 | 6 | 8 | 4 | 6 | 8 | 9 | 11 | 15 |
| 10:9 | 2 | 2 | 3 | 4 | 6 | 7 | 3 | 6 | 7 | 8 | 10 | 13 |
| 10:10 | 2 | 2 | 3 | 4 | 5 | 6 | 3 | 5 | 6 | 7 | 9 | 12 |
| 10:11 | 2 | 2 | 3 | 4 | 5 | 5 | 3 | 5 | 5 | 6 | 8 | 11 |
| 10:12 | 2 | 2 | 3 | 3 | 4 | 5 | 3 | 4 | 5 | 6 | 8 | 10 |
| 10:13 | 2 | 2 | 2 | 3 | 4 | 5 | 2 | 4 | 5 | 5 | 7 | 9 |
| 10:14 | **1** | **1** | 2 | 3 | 4 | 4 | 2 | 4 | 4 | 5 | 6 | 9 |
| 10:15 | **1** | **1** | 2 | 3 | 3 | 4 | 2 | 3 | 4 | 5 | 6 | 8 |
| 10:16 | **1** | **1** | 2 | 3 | 3 | 4 | 2 | 3 | 4 | 4 | 6 | 8 |
| 11:1 | 22 | 22 | 33 | 44 | 55 | 66 | 33 | 55 | 66 | 77 | 99 | 132 |
| 11:2 | 11 | 11 | 17 | 22 | 28 | 33 | 17 | 28 | 33 | 39 | 50 | 66 |
| 11:3 | 7 | 7 | 11 | 15 | 18 | 22 | 11 | 18 | 22 | 26 | 33 | 44 |
| 11:4 | 6 | 6 | 8 | 11 | 14 | 17 | 8 | 14 | 17 | 19 | 25 | 33 |
| 11:5 | 4 | 4 | 7 | 9 | 11 | 13 | 7 | 11 | 13 | 15 | 20 | 26 |
| 11:6 | 4 | 4 | 6 | 7 | 9 | 11 | 6 | 9 | 11 | 13 | 17 | 22 |
| 11:7 | 3 | 3 | 5 | 6 | 8 | 9 | 5 | 8 | 9 | 11 | 14 | 19 |
| 11:8 | 3 | 3 | 4 | 6 | 7 | 8 | 4 | 7 | 8 | 10 | 12 | 17 |
| 11:9 | 2 | 2 | 4 | 5 | 6 | 7 | 4 | 6 | 7 | 9 | 11 | 15 |
| 11:10 | 2 | 2 | 3 | 4 | 6 | 7 | 3 | 6 | 7 | 8 | 10 | 13 |
| 11:11 | 2 | 2 | 3 | 4 | 5 | 6 | 3 | 5 | 6 | 7 | 9 | 12 |
| 11:12 | 2 | 2 | 3 | 4 | 5 | 6 | 3 | 5 | 6 | 6 | 8 | 11 |
| 11:13 | 2 | 2 | 3 | 3 | 4 | 5 | 3 | 4 | 5 | 6 | 8 | 10 |
| 11:14 | 2 | 2 | 2 | 3 | 4 | 5 | 2 | 4 | 5 | 6 | 7 | 9 |
| 11:15 | **1** | **1** | 2 | 3 | 4 | 4 | 2 | 4 | 4 | 5 | 7 | 9 |
| 11:16 | **1** | **1** | 2 | 3 | 3 | 4 | 2 | 3 | 4 | 5 | 6 | 8 |
| 12:1 | 24 | 24 | 36 | 48 | 60 | 72 | 36 | 60 | 72 | 84 | 108 | 144 |
| 12:2 | 12 | 12 | 18 | 24 | 30 | 36 | 18 | 30 | 36 | 42 | 54 | 72 |
| 12:3 | 8 | 8 | 12 | 16 | 20 | 24 | 12 | 20 | 24 | 28 | 36 | 48 |
| 12:4 | 6 | 6 | 9 | 12 | 15 | 18 | 9 | 15 | 18 | 21 | 27 | 36 |
| 12:5 | 5 | 5 | 7 | 10 | 12 | 14 | 7 | 12 | 14 | 17 | 22 | 29 |
| 12:6 | 4 | 4 | 6 | 8 | 10 | 12 | 6 | 10 | 12 | 14 | 18 | 24 |
| 12:7 | 3 | 3 | 5 | 7 | 9 | 10 | 5 | 9 | 10 | 12 | 15 | 21 |
| 12:8 | 3 | 3 | 5 | 6 | 8 | 9 | 5 | 8 | 9 | 11 | 14 | 18 |
| 12:9 | 3 | 3 | 4 | 5 | 7 | 8 | 4 | 7 | 8 | 9 | 12 | 16 |
| 12:10 | 2 | 2 | 4 | 5 | 6 | 7 | 4 | 6 | 7 | 8 | 11 | 14 |
| 12:11 | 2 | 2 | 3 | 4 | 5 | 7 | 3 | 5 | 7 | 8 | 10 | 13 |
| 12:12 | 2 | 2 | 3 | 4 | 5 | 6 | 3 | 5 | 6 | 7 | 9 | 12 |
| 12:13 | 2 | 2 | 3 | 4 | 5 | 6 | 3 | 5 | 6 | 6 | 8 | 11 |
| 12:14 | 2 | 2 | 3 | 3 | 4 | 5 | 3 | 4 | 5 | 6 | 8 | 10 |
| 12:15 | 2 | 2 | 2 | 3 | 4 | 5 | 2 | 4 | 5 | 6 | 7 | 10 |
| 12:16 | 2 | 2 | 2 | 3 | 4 | 5 | 2 | 4 | 5 | 5 | 7 | 9 |
| 13:1 | 26 | 26 | 39 | 52 | 65 | 78 | 39 | 65 | 78 | 91 | 117 | 156 |
| 13:2 | 13 | 13 | 20 | 26 | 33 | 39 | 20 | 33 | 39 | 46 | 59 | 78 |
| 13:3 | 9 | 9 | 13 | 17 | 22 | 26 | 13 | 22 | 26 | 30 | 39 | 52 |
| 13:4 | 7 | 7 | 10 | 13 | 16 | 20 | 10 | 16 | 20 | 23 | 29 | 39 |
| 13:5 | 5 | 5 | 8 | 10 | 13 | 16 | 8 | 13 | 16 | 18 | 23 | 31 |
| 13:6 | 4 | 4 | 7 | 9 | 11 | 13 | 7 | 11 | 13 | 15 | 20 | 26 |
| 13:7 | 4 | 4 | 6 | 7 | 9 | 11 | 6 | 9 | 11 | 13 | 17 | 22 |
| 13:8 | 3 | 3 | 5 | 7 | 8 | 10 | 5 | 8 | 10 | 11 | 15 | 20 |
| 13:9 | 3 | 3 | 4 | 6 | 7 | 9 | 4 | 7 | 9 | 10 | 13 | 17 |
| 13:10 | 3 | 3 | 4 | 5 | 7 | 8 | 4 | 7 | 8 | 9 | 12 | 16 |
| 13:11 | 2 | 2 | 4 | 5 | 6 | 7 | 4 | 6 | 7 | 8 | 11 | 14 |
| 13:12 | 2 | 2 | 3 | 4 | 5 | 7 | 3 | 5 | 7 | 8 | 10 | 13 |
| 13:13 | 2 | 2 | 3 | 4 | 5 | 6 | 3 | 5 | 6 | 7 | 9 | 12 |
| 13:14 | 2 | 2 | 3 | 4 | 5 | 6 | 3 | 5 | 6 | 7 | 8 | 11 |
| 13:15 | 2 | 2 | 3 | 3 | 4 | 5 | 3 | 4 | 5 | 6 | 8 | 10 |
| 13:16 | 2 | 2 | 2 | 3 | 4 | 5 | 2 | 4 | 5 | 6 | 7 | 10 |
| 14:1 | 28 | 28 | 42 | 56 | 70 | 84 | 42 | 70 | 84 | 98 | 126 | 168 |
| 14:2 | 14 | 14 | 21 | 28 | 35 | 42 | 21 | 35 | 42 | 49 | 63 | 84 |
| 14:3 | 9 | 9 | 14 | 19 | 23 | 28 | 14 | 23 | 28 | 33 | 42 | 56 |
| 14:4 | 7 | 7 | 11 | 14 | 18 | 21 | 11 | 18 | 21 | 25 | 32 | 42 |
| 14:5 | 6 | 6 | 8 | 11 | 14 | 17 | 8 | 14 | 17 | 20 | 25 | 34 |
| 14:6 | 5 | 5 | 7 | 9 | 12 | 14 | 7 | 12 | 14 | 16 | 21 | 28 |
| 14:7 | 4 | 4 | 6 | 8 | 10 | 12 | 6 | 10 | 12 | 14 | 18 | 24 |
| 14:8 | 4 | 4 | 5 | 7 | 9 | 11 | 5 | 9 | 11 | 12 | 16 | 21 |
| 14:9 | 3 | 3 | 5 | 6 | 8 | 9 | 5 | 8 | 9 | 11 | 14 | 19 |
| 14:10 | 3 | 3 | 4 | 6 | 7 | 8 | 4 | 7 | 8 | 10 | 13 | 17 |
| 14:11 | 3 | 3 | 4 | 5 | 6 | 8 | 4 | 6 | 8 | 9 | 11 | 15 |
| 14:12 | 2 | 2 | 4 | 5 | 6 | 7 | 4 | 6 | 7 | 8 | 11 | 14 |
| 14:13 | 2 | 2 | 3 | 4 | 5 | 6 | 3 | 5 | 6 | 8 | 10 | 13 |
| 14:14 | 2 | 2 | 3 | 4 | 5 | 6 | 3 | 5 | 6 | 7 | 9 | 12 |
| 14:15 | 2 | 2 | 3 | 4 | 5 | 6 | 3 | 5 | 6 | 7 | 8 | 11 |
| 14:16 | 2 | 2 | 3 | 4 | 4 | 5 | 3 | 4 | 5 | 6 | 8 | 11 |
| 15:1 | 30 | 30 | 45 | 60 | 75 | 90 | 45 | 75 | 90 | 105 | 135 | 180 |
| 15:2 | 15 | 15 | 23 | 30 | 38 | 45 | 23 | 38 | 45 | 53 | 68 | 90 |
| 15:3 | 10 | 10 | 15 | 20 | 25 | 30 | 15 | 25 | 30 | 35 | 45 | 60 |
| 15:4 | 8 | 8 | 11 | 15 | 19 | 23 | 11 | 19 | 23 | 26 | 34 | 45 |
| 15:5 | 6 | 6 | 9 | 12 | 15 | 18 | 9 | 15 | 18 | 21 | 27 | 36 |
| 15:6 | 5 | 5 | 8 | 10 | 13 | 15 | 8 | 13 | 15 | 18 | 23 | 30 |
| 15:7 | 4 | 4 | 6 | 9 | 11 | 13 | 6 | 11 | 13 | 15 | 19 | 26 |
| 15:8 | 4 | 4 | 6 | 8 | 9 | 11 | 6 | 9 | 11 | 13 | 17 | 23 |
| 15:9 | 3 | 3 | 5 | 7 | 8 | 10 | 5 | 8 | 10 | 12 | 15 | 20 |
| 15:10 | 3 | 3 | 5 | 6 | 8 | 9 | 5 | 8 | 9 | 11 | 14 | 18 |
| 15:11 | 3 | 3 | 4 | 5 | 7 | 8 | 4 | 7 | 8 | 10 | 12 | 16 |
| 15:12 | 3 | 3 | 4 | 5 | 6 | 8 | 4 | 6 | 8 | 9 | 11 | 15 |
| 15:13 | 2 | 2 | 3 | 5 | 6 | 7 | 3 | 6 | 7 | 8 | 10 | 14 |
| 15:14 | 2 | 2 | 3 | 4 | 5 | 6 | 3 | 5 | 6 | 8 | 10 | 13 |
| 15:15 | 2 | 2 | 3 | 4 | 5 | 6 | 3 | 5 | 6 | 7 | 9 | 12 |
| 15:16 | 2 | 2 | 3 | 4 | 5 | 6 | 3 | 5 | 6 | 7 | 8 | 11 |
| 16:1 | 32 | 32 | 48 | 64 | 80 | 96 | 48 | 80 | 96 | 112 | 144 | 192 |
| 16:2 | 16 | 16 | 24 | 32 | 40 | 48 | 24 | 40 | 48 | 56 | 72 | 96 |
| 16:3 | 11 | 11 | 16 | 21 | 27 | 32 | 16 | 27 | 32 | 37 | 48 | 64 |
| 16:4 | 8 | 8 | 12 | 16 | 20 | 24 | 12 | 20 | 24 | 28 | 36 | 48 |
| 16:5 | 6 | 6 | 10 | 13 | 16 | 19 | 10 | 16 | 19 | 22 | 29 | 38 |
| 16:6 | 5 | 5 | 8 | 11 | 13 | 16 | 8 | 13 | 16 | 19 | 24 | 32 |
| 16:7 | 5 | 5 | 7 | 9 | 11 | 14 | 7 | 11 | 14 | 16 | 21 | 27 |
| 16:8 | 4 | 4 | 6 | 8 | 10 | 12 | 6 | 10 | 12 | 14 | 18 | 24 |
| 16:9 | 4 | 4 | 5 | 7 | 9 | 11 | 5 | 9 | 11 | 12 | 16 | 21 |
| 16:10 | 3 | 3 | 5 | 6 | 8 | 10 | 5 | 8 | 10 | 11 | 14 | 19 |
| 16:11 | 3 | 3 | 4 | 6 | 7 | 9 | 4 | 7 | 9 | 10 | 13 | 17 |
| 16:12 | 3 | 3 | 4 | 5 | 7 | 8 | 4 | 7 | 8 | 9 | 12 | 16 |
| 16:13 | 2 | 2 | 4 | 5 | 6 | 7 | 4 | 6 | 7 | 9 | 11 | 15 |
| 16:14 | 2 | 2 | 3 | 5 | 6 | 7 | 3 | 6 | 7 | 8 | 10 | 14 |
| 16:15 | 2 | 2 | 3 | 4 | 5 | 6 | 3 | 5 | 6 | 7 | 10 | 13 |
| 16:16 | 2 | 2 | 3 | 4 | 5 | 6 | 3 | 5 | 6 | 7 | 9 | 12 |

# Table B — bar-line closure error, ranked by severity

All 56 preset combinations that do not close on the bar line, at 120 BPM, ranked by
how far the bar-line gap deviates from the in-bar gap. `gap/step` of 1.0000 would be
perfect closure; 0.5000 means the note after the bar line arrives twice as soon as the
ear expects. The remaining 28 of the 84 preset combinations close exactly.

| # | sig | ratio | ppb | ideal notes | emitted | in-bar gap (s) | bar-line gap (s) | gap/step |
|--:|---|---|--:|--:|--:|--:|--:|--:|
| 1 | 6/4 | 5:4 | 6 | 7.5000 | 8 | 0.40000 | 0.20000 | 0.5000 |
| 2 | 6/8 | 5:4 | 6 | 7.5000 | 8 | 0.40000 | 0.20000 | 0.5000 |
| 3 | 2/2 | 5:4 | 2 | 2.5000 | 3 | 0.40000 | 0.20000 | 0.5000 |
| 4 | 2/4 | 5:4 | 2 | 2.5000 | 3 | 0.40000 | 0.20000 | 0.5000 |
| 5 | 2/2 | 3:4 | 2 | 1.5000 | 2 | 0.66667 | 0.33333 | 0.5000 |
| 6 | 2/4 | 3:4 | 2 | 1.5000 | 2 | 0.66667 | 0.33333 | 0.5000 |
| 7 | 3/4 | 3:2 | 3 | 4.5000 | 5 | 0.33333 | 0.16667 | 0.5000 |
| 8 | 4/4 | 7:8 | 4 | 3.5000 | 4 | 0.57143 | 0.28571 | 0.5000 |
| 9 | 6/4 | 3:4 | 6 | 4.5000 | 5 | 0.66667 | 0.33333 | 0.5000 |
| 10 | 3/8 | 3:2 | 3 | 4.5000 | 5 | 0.33333 | 0.16667 | 0.5000 |
| 11 | 6/8 | 3:4 | 6 | 4.5000 | 5 | 0.66667 | 0.33333 | 0.5000 |
| 12 | 5/4 | 3:2 | 5 | 7.5000 | 8 | 0.33333 | 0.16667 | 0.5000 |
| 13 | 5/8 | 3:2 | 5 | 7.5000 | 8 | 0.33333 | 0.16667 | 0.5000 |
| 14 | 7/8 | 3:2 | 7 | 10.5000 | 11 | 0.33333 | 0.16667 | 0.5000 |
| 15 | 9/8 | 3:2 | 9 | 13.5000 | 14 | 0.33333 | 0.16667 | 0.5000 |
| 16 | 12/8 | 7:8 | 12 | 10.5000 | 11 | 0.57143 | 0.28571 | 0.5000 |
| 17 | 5/4 | 7:8 | 5 | 4.3750 | 4 | 0.57143 | 0.78571 | 1.3750 |
| 18 | 5/8 | 7:8 | 5 | 4.3750 | 4 | 0.57143 | 0.78571 | 1.3750 |
| 19 | 3/4 | 7:8 | 3 | 2.6250 | 3 | 0.57143 | 0.35714 | 0.6250 |
| 20 | 3/8 | 7:8 | 3 | 2.6250 | 3 | 0.57143 | 0.35714 | 0.6250 |
| 21 | 2/2 | 5:3 | 2 | 3.3333 | 3 | 0.30000 | 0.40000 | 1.3333 |
| 22 | 2/4 | 5:3 | 2 | 3.3333 | 3 | 0.30000 | 0.40000 | 1.3333 |
| 23 | 2/2 | 4:3 | 2 | 2.6667 | 3 | 0.37500 | 0.25000 | 0.6667 |
| 24 | 2/4 | 4:3 | 2 | 2.6667 | 3 | 0.37500 | 0.25000 | 0.6667 |
| 25 | 4/4 | 2:3 | 4 | 2.6667 | 3 | 0.75000 | 0.50000 | 0.6667 |
| 26 | 5/4 | 4:3 | 5 | 6.6667 | 7 | 0.37500 | 0.25000 | 0.6667 |
| 27 | 5/8 | 4:3 | 5 | 6.6667 | 7 | 0.37500 | 0.25000 | 0.6667 |
| 28 | 7/8 | 2:3 | 7 | 4.6667 | 5 | 0.75000 | 0.50000 | 0.6667 |
| 29 | 2/2 | 2:3 | 2 | 1.3333 | 1 | 0.75000 | 1.00000 | 1.3333 |
| 30 | 2/4 | 2:3 | 2 | 1.3333 | 1 | 0.75000 | 1.00000 | 1.3333 |
| 31 | 4/4 | 4:3 | 4 | 5.3333 | 5 | 0.37500 | 0.50000 | 1.3333 |
| 32 | 5/4 | 2:3 | 5 | 3.3333 | 3 | 0.75000 | 1.00000 | 1.3333 |
| 33 | 5/8 | 2:3 | 5 | 3.3333 | 3 | 0.75000 | 1.00000 | 1.3333 |
| 34 | 7/8 | 4:3 | 7 | 9.3333 | 9 | 0.37500 | 0.50000 | 1.3333 |
| 35 | 5/4 | 5:3 | 5 | 8.3333 | 8 | 0.30000 | 0.40000 | 1.3333 |
| 36 | 5/8 | 5:3 | 5 | 8.3333 | 8 | 0.30000 | 0.40000 | 1.3333 |
| 37 | 4/4 | 5:3 | 4 | 6.6667 | 7 | 0.30000 | 0.20000 | 0.6667 |
| 38 | 7/8 | 5:3 | 7 | 11.6667 | 12 | 0.30000 | 0.20000 | 0.6667 |
| 39 | 3/4 | 5:4 | 3 | 3.7500 | 4 | 0.40000 | 0.30000 | 0.7500 |
| 40 | 3/8 | 5:4 | 3 | 3.7500 | 4 | 0.40000 | 0.30000 | 0.7500 |
| 41 | 7/8 | 5:4 | 7 | 8.7500 | 9 | 0.40000 | 0.30000 | 0.7500 |
| 42 | 3/4 | 3:4 | 3 | 2.2500 | 2 | 0.66667 | 0.83333 | 1.2500 |
| 43 | 6/4 | 7:8 | 6 | 5.2500 | 5 | 0.57143 | 0.71429 | 1.2500 |
| 44 | 3/8 | 3:4 | 3 | 2.2500 | 2 | 0.66667 | 0.83333 | 1.2500 |
| 45 | 6/8 | 7:8 | 6 | 5.2500 | 5 | 0.57143 | 0.71429 | 1.2500 |
| 46 | 7/8 | 3:4 | 7 | 5.2500 | 5 | 0.66667 | 0.83333 | 1.2500 |
| 47 | 5/4 | 5:4 | 5 | 6.2500 | 6 | 0.40000 | 0.50000 | 1.2500 |
| 48 | 5/4 | 3:4 | 5 | 3.7500 | 4 | 0.66667 | 0.50000 | 0.7500 |
| 49 | 5/8 | 5:4 | 5 | 6.2500 | 6 | 0.40000 | 0.50000 | 1.2500 |
| 50 | 5/8 | 3:4 | 5 | 3.7500 | 4 | 0.66667 | 0.50000 | 0.7500 |
| 51 | 9/8 | 5:4 | 9 | 11.2500 | 11 | 0.40000 | 0.50000 | 1.2500 |
| 52 | 9/8 | 3:4 | 9 | 6.7500 | 7 | 0.66667 | 0.50000 | 0.7500 |
| 53 | 2/2 | 7:8 | 2 | 1.7500 | 2 | 0.57143 | 0.42857 | 0.7500 |
| 54 | 2/4 | 7:8 | 2 | 1.7500 | 2 | 0.57143 | 0.42857 | 0.7500 |
| 55 | 7/8 | 7:8 | 7 | 6.1250 | 6 | 0.57143 | 0.64286 | 1.1250 |
| 56 | 9/8 | 7:8 | 9 | 7.8750 | 8 | 0.57143 | 0.50000 | 0.8750 |
