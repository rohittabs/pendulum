# Pendulum: deep test brief for Song Mode, Polyrhythm and Swing

You are testing three specific areas of **Pendulum**, a metronome PWA. Ignore everything else. Do not test the UPI payment flow at all.

I have already run 423 assertions against the general engine with zero failures, so the ordinary paths are clean. Do not spend time re-proving them. These three areas are where the code is newest, most interlocking, and least proven.

**I have already reproduced five concrete issues.** They are listed at the bottom under "Confirmed leads". Start by reproducing each one yourself so you trust your harness, then go hunting for what I missed.

---

## Ground rules

1. **Derive expected values independently**, from musical first principles, before you look at what the code computes. If you read the expected value off the implementation, the test proves nothing.
2. **A passing suite on the first run means your tests are too weak**, not that the app is correct.
3. **When something fails, say whether the app or the test is wrong, and show the arithmetic.** I have had cases in this project where my expected value was wrong and the app was right. Do not assume the code is at fault.
4. **Never weaken an assertion to make it pass.** Leave it failing and explain.
5. **Do not modify application source.** Report only.
6. Use `tests/extract.mjs` to load the engine at run time. It already works.

---

## Area 1: Polyrhythm

The implementation was rewritten recently and is the least proven code in the app. It is now:

```js
if (s.poly && s.poly.x > 1) {
  const py = Math.max(1, s.poly.y || 1), px = s.poly.x;
  const step = (t - barStart) / ppb * py / px;
  const n = Math.round(ppb / py * px);
  for (let p = 0; p < n; p++)
    ev.push({ t: barStart + step * p, k: 'poly', a: p % px === 0 ? 2 : 0, bar, pi: p % px, ... });
}
```

Everything hinges on `Math.round(ppb / py * px)`. Attack it.

### Must test

- **Note count.** For every ratio from 2:2 to 16:16 crossed with all 12 preset signatures and all 13 note values, assert the note count is at least 2 and that a polyrhythm the user switched on is actually audible.
- **Downbeat alignment.** The first poly note of every bar must coincide exactly with that bar's downbeat, at every tempo, with ramps on, and with every note value.
- **Bar-line closure.** Quantify how far each combination is from a whole number of notes, and rank by severity. Report the full table.
- **Even spacing within a bar**, and separately, what the gap is *across* the bar line.
- **Accent placement.** Accents fall every `px` notes. When `n` is not a multiple of `px`, the last cycle is truncated. Does the next bar's accent still land on the downbeat, and does the truncation ever produce two accents in a row?
- **Ramp interaction.** Bar duration changes every bar during a ramp. Confirm poly spacing tracks it and the last poly note never crosses into the next bar. I believe this one is correct, so verify rather than assume.
- **Mute agreement.** On a muted bar, every poly event must be muted too, or the dots will disagree with the audio.
- **Note value interaction.** 4:3 in 6/8 at dotted quarter has 2 pulses to work with; the same ratio at eighth has 6. This crossing has never been tested.
- **Song mode.** Different poly per section, poly on some sections and not others, and the seam between them.

---

## Area 2: Swing

```js
function subOffsets(subdiv, mode, amount) {
  if (mode === 'off' || SWING_SUBDIV[mode] !== subdiv)
    return Array.from({length: subdiv}, (_, i) => i / subdiv);
  const r = amount / 100;
  const pairs = subdiv / 2, span = 1 / pairs;
  const out = [];
  for (let p = 0; p < pairs; p++) { out.push(p*span); out.push(p*span + span*r); }
  return out;
}
```

### Must test

- **The core invariant: swing never moves the pulses.** For every mode and every amount from 50 to 75, main pulses stay at exact multiples of the pulse duration and total bar length is unchanged. If this ever fails, tempo drifts while the user drags the slider.
- **Amount 50 is byte-identical to off**, for both 8th and 16th.
- **67 gives exactly 2:1, 75 gives exactly 3:1.** Compute the ratio from slot durations, not from the offsets, and do not round before dividing.
- **Slot durations always sum to exactly 1**, and every slot is strictly positive.
- **Mismatched subdivision falls back to straight.** Test `8th` against subdivisions 1, 3, 4, 5, 6, 7, 8 and `16th` against 1, 2, 3, 5, 6, 7, 8.
- **Out-of-range amounts.** See confirmed lead 3. There is no clamp inside the function.
- **Song mode.** Swing is global but each section carries its own subdivision. A section whose subdivision does not match must play straight while its neighbours swing. Verify the seam between a swung and a straight section drops no beat and creates no duplicate timestamp.
- **Swing must not reach the polyrhythm.** Poly notes must be identical with swing on and off. I have verified this holds; confirm it independently.
- **Swing with ramps**, where the pulse duration changes every beat. The swung offbeat must stay proportional to its own pulse, not to some earlier one.
- **Extremes.** 300 BPM, 16th swing, 75%. Find the shortest slot and confirm it stays above 10 ms.

---

## Area 3: Song Mode

### Must test

- **Seams.** Build songs that change signature, note value, tempo, subdivision and accent pattern at every join. For each: no duplicate timestamps, no backwards time, exactly one downbeat per bar, continuous bar counter.
- **Duration.** Total duration must equal the analytic sum computed independently. Do this for a 20-section song where every section differs.
- **Repeats and loops.** Verify nesting: repeats inside sections, then whole-song loop on top. Check the bar counter, the timeline continuity at both boundaries, and whether a ramp restarts per repeat (see confirmed lead 4).
- **States resize.** When a section's signature or note value changes, its `states` array must resize by index, pad with plain clicks, and never leave a bar without an accent. Feed sections deliberately wrong-length `states` arrays and confirm graceful fallback.
- **Degenerate sections.** Zero bars, negative bars, fractional bars, one pulse per bar, 32 pulses per bar, a ramp inside a one-beat section, a section with every beat muted.
- **Export and import.** Round-trip deep equality. Then feed it: malformed JSON, valid JSON that is not a song, a song with zero sections, a song with a section missing required fields, a song with a `noteValue` that does not divide its signature, a song with a swing amount of 400, and a very large song. Each must fail gracefully with a message, never a crash or a poisoned timeline.
- **Bar map indexing.** One tick per bar; tapping tick N seeks to bar N. Check the off-by-one at the first and last bar, and after a section is deleted or reordered.
- **Random silent bars across sections.** Confirm seeds are indexed by global bar so two sections with the same seed do not mute identically.
- **The three built-in examples** load, play, and report durations matching the engine.

---

## Confirmed leads

I reproduced all five. Start here.

### 1. Custom polyrhythm ratios can be silent or a single note

`Math.round(ppb / py * px)` can round to 0 or 1.

```
2/4 quarter, ppb=2, poly 2:16  ->  0 notes     (polyrhythm on, nothing plays)
3/8 dquarter, ppb=1, poly 3:16 ->  0 notes
2/4 quarter, ppb=2, poly 2:3   ->  1 note      (just the downbeat, not a rhythm)
4/4 quarter, ppb=4, poly 2:16  ->  1 note
```

A user turns polyrhythm on and hears nothing, with no explanation. Determine the full set of ratio-and-signature pairs that produce fewer than 2 notes, and check whether the UI lets a user reach any of them. If it does, the ratio should be disabled the way invalid note values already are.

### 2. Two thirds of preset polyrhythms do not close on the bar line

Across the 12 preset signatures crossed with the 7 preset ratios, **56 of 84** produce a non-integer ideal note count. Example, 5/4 with 4:3:

```
ideal = 5/3*4 = 6.667  ->  rounds to 7
bar 0 poly: 0, 0.375, 0.75, 1.125, 1.5, 1.875, 2.25   (bar ends at 2.5)
gaps: 0.375 inside the bar, 0.25 across the bar line
```

Every downbeat still aligns, which is defensible for a metronome, but the stutter at the bar line is audible. Decide whether this is intended, then either document it or disable the affected ratios. Rank all 56 by how far from a whole number they fall.

### 3. Swing amount has no clamp inside the engine

`subOffsets` divides `amount` by 100 with no validation. Only the slider constrains the range, but `swingAmount` is persisted to localStorage and travels in exported songs.

```
amount NaN       -> every event time NaN
amount undefined -> every event time NaN
amount 120       -> offbeat at 1.2, outside its own pulse
amount -10       -> offbeat at -0.1, before the pulse starts
amount 0         -> offbeat at 0, two notes on the same instant, zero-length slot
amount 100       -> offbeat lands exactly on the next pulse
```

Test the path that matters: corrupt `swingAmount` in localStorage, and import a song carrying an out-of-range value. Does the app clamp on load, or does a poisoned timeline reach the scheduler?

### 4. A ramp restarts on every repeat

A section with 2 bars, 60 to 120 BPM, repeat 3 produces three separate 60-to-120 ramps rather than one continuous ramp across six bars.

```
repeat 0: 60, 68.6, 77.1, 85.7, 94.3, 102.9, 111.4, 120
repeat 1: 60, 68.6, ...  (identical)
repeat 2: 60, 68.6, ...  (identical)
```

This is probably intended, since a repeat means "play this section again". But a user building a speed ramp with repeats would reasonably expect one continuous climb. Confirm which it is and check the UI makes it obvious.

### 5. Fractional bar counts round up silently

```
bars = 0.5  ->  4 events, one full bar
bars = 1.7  ->  8 events, two full bars
bars = -1   ->  0 events (safe)
```

The loop runs `ceil(bars)` times. Check whether the UI or the import path can ever set a fractional value. If import can, it should validate.

---

## Deliverables

`tests/REPORT.md` containing:

- assertions run, passed, failed, broken down by the three areas
- every failure with a minimal reproduction and your verdict on app-versus-test
- the two full tables: polyrhythm note counts by ratio and signature, and bar-line closure error ranked by severity
- a severity ranking based on what a user would actually notice
- a plain statement of which of the three areas you now consider proven and which are still not

Work through polyrhythm first, then swing, then song mode. Show failures as you find them.
