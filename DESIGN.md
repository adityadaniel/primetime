# DESIGN — "PRIMETIME"

A real-time quiz game has the bones of a TV game show. So the visual identity for this build is exactly that: a **vintage broadcast graphics package** — late-60s through mid-70s control-room aesthetics, Swiss editorial rigor, and the deliberate feel of a network on-air kit. Cream paper instead of glass white, hot vermilion instead of millennial purple, oversized condensed display numerals as the dominant element, monospace tickers for scores, and SMPTE-flavored frame counters and "ON AIR" indicators as decorative anchors. Every screen is staged like a broadcast frame: question number reads like a chyron, the projection display is the main camera feed, the host control panel is the director's console, and the player phone is the talent's confidence monitor. This is unmistakably a game show, not a SaaS dashboard.

The name is the slot. *PRIMETIME* is the flagship broadcast window — the marquee hour a network reserves for the show the whole room is tuned in for, and a live quiz is exactly that show. The host control panel is the director's console **cutting the prime-time broadcast** — every cue, advance, and override originates there. The projection display is the **on-air feed going out live in the marquee slot**, routed to the room's screen. Players are the audience tuning in, their answers locked in and tabulated on air as packets of color and shape. Vintage broadcast graphics already speaks this language fluently: test cards warm up the slot, scanlines carry the live feed, frame counters timestamp the transmission, station IDs identify the channel. *PRIMETIME* is a sharper name for the kit that's already being assembled below.

## Palette

```
--bone:      #F2EBDC   /* warm cream paper — primary background */
--ink:       #0F0F0F   /* near-black workhorse */
--vermilion: #E5341F   /* accent — live indicator, primary CTA, urgency */
--marigold:  #F2A900   /* secondary accent — circle answer, highlights */
--cobalt:    #1B3A6B   /* triangle/circle support */
--ivy:       #1F4D3A   /* correct state, square answer */
--ash:       #B7B0A1   /* hairlines, dimmed states */
```

Single-direction commitment: cream paper for everything except the projection display in question state, which inverts to ink for room-darkening contrast.

## Type

- **Display:** Big Shoulders Display, weight 900. Condensed broadcast caps for question numbers, PIN digits, podium numerals. Used heavily and confidently — fills 30–50% of screen height in projection state.
- **Editorial body:** Newsreader. A contemporary serif with strong italics for emphasis ("LIVE", "FRAME 047"). Used for question text and meta copy.
- **Mono numerals:** JetBrains Mono. Score tickers, countdowns, PIN entry, response counts. Tabular numbers everywhere a digit changes.

No Inter. No Space Grotesk. No Roboto.

## The 4 Answer Shapes

Each is a distinct geometric channel — distinguishable by shape alone (WCAG color-not-the-only-signal). Reinterpreted as solid fills with a 2px ink border and a small "channel marker" label (CH.1 / CH.2 / CH.3 / CH.4) like broadcast lower-thirds.

| Shape | Color | Channel |
|-------|-------|---------|
| Triangle | Vermilion | CH.1 |
| Diamond | Cobalt | CH.2 |
| Circle | Marigold | CH.3 |
| Square | Ivy | CH.4 |

(Diamond replaces "circle" from PRD's color list; circle replaces "star" — the four shapes remain shape-distinct, and the swap pulls the system toward broadcast geometry. Star felt too literal for the aesthetic. The PRD requires four distinguishable shapes; it does not require those exact four.)

## Motion

Motion serves the broadcast-cut feel, not decoration:

- **Cuts, not fades.** Transitions snap. White flash on reveal, like a camera shutter.
- **Teleprompter slide.** Question text rises in from below, tight cubic-bezier, never bouncy.
- **Countdown ring** — thick ink stroke, no easing on the tick, robotic.
- **Locked-in stamp.** Player answer rotates 4° and "stamps" with a hard shadow, like a producer's approval mark.
- **Ticker** — leaderboard scrolls with monospace tabular numerals snapping into place; no smooth interpolation.
- **Pulse** — only one element pulses: the "ON AIR" dot during active question. Nothing else.

Animations are present and intentional but never twee.

## Decorative anchors

- Faint hairline grid baseline on cream surfaces (visible but quiet)
- "FRAME nnn" counter in top-right corner of every host/display screen, increments with question index
- "ON AIR" badge with vermilion dot pulsing during live question state
- Crop marks / registration marks at corners of the projection display
- SMPTE color-bar strip as the lobby loading bar
- Halftone dot texture in the pixel-pushed shadows under chyrons

## Surface inventory

| Surface | Treatment |
|---------|-----------|
| `/` landing | Bone background, oversized two-line "PRIME / TIME" wordmark (PRIME in vermilion, TIME in ink), two CTAs (host / join) |
| `/host` builder | Director's worksheet — question rows feel like cue cards on a clipboard |
| `/host/[pin]/control` | Control room — split panes, dense, monospace-heavy, response meters |
| `/host/[pin]/display` | The on-air feed. Inverts to ink during question state. Huge type. |
| `/join` & `/play/[pin]` | Talent confidence monitor — bone, large tap targets, single column, thumb-zone |

Coherent across all five surfaces: same palette, same type stack, same frame counter, same "ON AIR" treatment, same answer shapes.

## OSS vs SaaS feature surface

This codebase ships two modes via environment flags:

- **OSS (default):** Password auth, no email, local file uploads, no billing, player cap 10. Zero SaaS dependencies.
- **SaaS:** Add OAuth, SMTP/Resend email, S3/UploadThing cloud uploads, Stripe billing, higher player caps by tier.

The visual identity is identical in both modes — only the feature surface changes. See the [environment reference in README](README.md#environment-reference) for all flags.

