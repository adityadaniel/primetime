# Competitive Pricing Reference — Real-time Quiz / Polling Tools

**Last researched:** May 2026
**Use:** Reference when scoping BROADCAST's free tier limits, Pro tier features, and pricing later.
**Caveat:** Pricing pages change frequently. Re-verify before committing to public launch.

---

## TL;DR — What to copy, what to charge for

The market has converged on a tight pattern across all four major players (Kahoot, Slido, Mentimeter, Wayground/Quizizz):

- **Free tier is generous on participants** but throttled on (a) advanced question types, (b) AI generation, (c) custom branding, (d) report export, (e) team/multi-host, (f) integrations.
- **AI generation is the universal paywall in 2025/2026.** Every paid tier leads with "AI" as the headline benefit. Image generation and full-length-PDF/document-to-quiz are the highest gates.
- **Annual-only billing** is becoming the default for paid plans (Kahoot 360 dropped monthly entirely).
- **Education is reliably 40-50% cheaper** than business-equivalent tiers.
- **Commercial/marketing-use licensing** is a real differentiator — Kahoot's Pro Max ($69/mo) is the only Kahoot tier that allows webinars, conferences, paid services. Other platforms don't gate this as aggressively.
- **SSO/SCIM/LMS integration** is uniformly enterprise-only across all four platforms.

**Where the open lane is** for a focused academy/education tool like BROADCAST:
- Mid-tier individual-teacher pricing — Wayground killed their "Super" individual paid plan, leaving free → quote-only.
- Honest free-tier player caps — Kahoot dropped from 50 → 40, Wayground caps at 100, Slido at 100.
- Low-friction commercial use — Kahoot only allows it on Max, others gate it via enterprise.
- CSV/Excel reports on free tier — every competitor charges for full export.

---

## 1. Kahoot — separated into two brands

Sources: [kahoot.com/schools/plans](https://kahoot.com/schools/plans/), [kahoot360.com/pricing](https://kahoot360.com/pricing/)

**Brand split (2025/2026):** Education → kahoot.com, Business → kahoot360.com. All paid plans annual-only.

### Free — Kahoot! Go
- 40 participants
- Quiz + true/false only (no polls, no word cloud, no open-ended)
- 1 image from premium library
- Reports limited to 3 participants × 3 questions
- **Zero AI**

### Education plans (per teacher)
| Tier | $/mo (annual) | Players | Headline adds |
|---|---|---|---|
| Bronze | $3 | 50 | + Puzzle question, 1-page PDF AI, full report download |
| **Silver** | $7 | 100 | + Polls, drop pin, scale, image reveal, multi-select, lecture mode, slide import, 150-page PDF AI, custom logo |
| Gold | $12 | 200 | + Type answer, slider, presentation AI, combine reports, course reporting |
| One | $19 | 800 | + All AI (incl. image gen, step-by-step solver), 50 student passes |

### Business plans — Kahoot! 360
| Tier | $/mo (annual) | Players | Headline adds |
|---|---|---|---|
| Start | $19 | 50 | Quiz/multi-select/puzzle, polls, 1-page PDF AI |
| **Standard** | $25 | 200 | + Word cloud, brainstorm, drop pin, open-ended, type answer, slider, Q&A, slide sync, 150pp PDF |
| Plus | $49 | 1,000 | + Courses, certificates, NPS, story format + AI, custom theming, AI image gen |
| Max | $69 | 2,000 | + Immersive branding, moderated Q&A, **commercial/marketing license** |
| Enterprise | sales | — | LTI 1.3, SSO, SCIM, reporting API |

### Hard wall worth knowing
**Commercial/marketing/advertising/paid services use is forbidden below Pro Max.** Webinars, conferences, recruitment, paid training all require Max+ or Enterprise.

### Notable 2025/26 changes
- Free tier player cap dropped 50 → 40
- Monthly billing removed
- "Pro/Premium/Premium+" naming gone — replaced with Start/Standard/Plus/Max
- Free tier rebranded "Kahoot! Go"

---

## 2. Slido — Cisco/Webex-owned, audience-interaction-first

Source: [slido.com/pricing](https://www.slido.com/pricing)

### Annual subscription
| Tier | $/mo (annual) | Annual | Participants | Members |
|---|---|---|---|---|
| **Basic** (Free) | $0 | $0 | 100 | 1 |
| Engage | $12.50 | $150 | 200 | 1 (max 5) |
| Professional | $50 | $600 | 1,000 | 2 (max 50) |
| Enterprise | $150 | $1,800 | 5,000 | 3 (unlimited) |

### One-time event pricing (7-day window)
- Basic: $0 / 100 participants
- Engage: $80 / 200
- Professional: $250 / 1,000
- Premium: $700 / 5,000

### Feature gating
- **Free has 3 polls/slido + 1 quiz/slido** (heavy throttle on free)
- **Surveys:** Engage+
- **Q&A moderation, advanced settings, replies, labels:** Professional+
- **Custom theme, logo, partner logos:** Professional+
- **Data export:** Engage+ (format not stated — likely CSV/XLSX)
- **Multi-room workspaces:** Professional+
- **Spaces (org-level workspace separation):** Enterprise-only
- **AI Support Assistant:** Engage+
- **SSO + SCIM:** Enterprise-only

### Education
- Marketing page only — no public pricing tiers
- Headline: **"as low as $7/mo, billed annually" / 500 students**
- Education plan URLs (`/education-plans`, `/education/plans`) currently 404 → sales-led

### Notable
- Webex integration not listed in the comparison table despite Cisco ownership
- Slido is **Q&A-and-polls-first**, quiz is secondary — different positioning from Kahoot/Wayground
- **30-day money-back** on all paid plans
- Custom enterprise tier above Enterprise: 10+ members, 20,000 participants, custom billing

---

## 3. Mentimeter — polling/presentation crossover

Source: [mentimeter.com/plans](https://www.mentimeter.com/plans)

**Note:** Pricing page geo-detects currency. Prices below are in **EUR** (USD prices shown only when accessed from US IP). Treat numbers as reference; expect rough USD parity.

### Business plans (per presenter)
| Tier | €/mo annual | €/mo monthly | Participants | Slide types |
|---|---|---|---|---|
| **Free** | €0 | €0 | 50/month | 23 |
| Basic | €14 | €17.99 | Unlimited | Unlimited |
| Pro | €28 | yearly only | Unlimited | Unlimited |
| Enterprise | custom | yearly only | Unlimited | Unlimited |

### Education plans (discounted)
| Tier | €/mo annual | €/mo monthly |
|---|---|---|
| Free | €0 | €0 |
| Basic | €11 | €12.99 |
| Pro | €17 | yearly only |
| **Campus** | custom | yearly only |

### Feature gating
- **Free:** 50 participants/month, 23 slide types, **Menti AI included**, Q&A
- **Basic adds:** Unlimited participants/types, slide import (PowerPoint/Keynote/PDF), Excel/PDF/Image export, segmentation, workspace roles
- **Pro adds:** Embed slides (PowerPoint Web, Google Slides, Miro), private presentations, participant names, custom colors/themes/branding/logo, collaborative workspace, edit together, templates, Q&A moderation, Mentimote™, Quick Forms, multiple answers from one device
- **Enterprise/Campus adds:** SSO, SCIM, verify participants with SSO, **LMS integration**, groups, workspace insights, custom data retention

### Notable
- **Free tier includes Menti AI** — only platform here that gives AI generation away on free
- **Pro is the practical "real" tier** at €28/mo — adds collaboration, branding, embed, moderation
- Image/PDF/Excel export gated at Basic
- API access **not stated** anywhere on pricing page

---

## 4. Wayground (formerly Quizizz) — most direct competitor, recent rebrand

Sources: [wayground.com/home/plans](https://wayground.com/home/plans) (K-12), [wayground.com/forbusiness/plans](https://wayground.com/forbusiness/plans) (Corporate)

**Major change:** Quizizz rebranded to Wayground. `quizizz.com/pricing` 404s. **The previous "Quizizz Super" individual paid plan is no longer publicly sold** — collapsed into Free → quote-based School/District.

### K-12 Plans
| Tier | Price | Students | Activity storage | Question types |
|---|---|---|---|---|
| **Basic** (Free) | $0 | 100 | 20 max | "Limited" (not enumerated) |
| School and District | quote-only | Unlimited | Unlimited | All 20+ types |

#### Free includes a lot
- Live + student-paced delivery
- AI generation/import (free!), AI answer explanations
- 25+ accommodations including Read Aloud
- Standards-aligned reports, longitudinal growth graphs
- SSO with Google/Microsoft/Clever/ClassLink
- Anti-cheating alerts, autograding, multiple classes

#### School/District adds
- Full AI grading with custom rubrics
- Identify small groups + AI resource recommendations
- Admin dashboard with school/district insights
- Anti-cheating prevention (vs alerts)
- Co-teaching/teams
- LMS (Canvas, Schoology LTI 1.3), grade passback
- 40M+ standards-aligned resource library ("Teleport")
- Add-ons: standards mastery, state test data import, item bank

### Corporate Plans (Wayground for Business)
| Tier | $/mo or annual | Seats | Participants/session | Headline adds |
|---|---|---|---|---|
| Essential-Monthly | $125/mo | 1 | 150 | Standard question types, doc import, live + async |
| **Essential** | $900/yr ($75/mo) | 3 | 150 | + 24/7 support |
| Pro | $1,500/yr ($125/mo) | 5 (min) | 1,000 | + AI Creation, AI translation (180 langs), courses, visual question types, group/team rostering |
| Enterprise | quote-only | — | — | Custom branding, REST API, advanced integrations |

### Notable
- **Free tier on Wayground is the most generous of any competitor** — AI generation, AI explanations, standards reports, SSO all included
- **No public middle tier for individual teachers** — the "Super" tier was killed in the rebrand. Market opening here.
- Heavy AI positioning: AI creation, AI translation, AI grading w/ rubrics, AI explanations, "admin chat with data"
- Custom branding gated behind Enterprise quote
- Question type list never enumerated publicly — only "limited" vs "all 20+"

---

## 5. Cross-platform comparison

### Free tier player caps
| Platform | Free cap |
|---|---|
| Kahoot Go | 40 |
| Mentimeter Free | 50/mo |
| Slido Basic | 100 |
| Wayground Basic | 100 |

### Cheapest paid tier
| Platform | Tier | $/mo annual |
|---|---|---|
| Kahoot Bronze (edu) | $3 | 50 players |
| Slido Engage | $12.50 | 200 |
| Mentimeter Basic (edu) | ~€11 (~$12) | unlimited |
| Wayground Essential (business) | $75 | 150 |

### Cheapest tier with AI generation
| Platform | Tier | $/mo |
|---|---|---|
| **Wayground Basic (free)** | $0 | AI generation included |
| **Mentimeter Free** | $0 | Menti AI included |
| Kahoot Bronze (edu) | $3 | 1-page PDF only |
| Slido | not specified — only "AI Support Assistant" at Engage+ |

### Cheapest tier with custom branding (logo/theme)
| Platform | Tier | $/mo |
|---|---|---|
| Kahoot Silver (edu) | $7 | logo only |
| Mentimeter Pro (edu) | ~€17 | full custom |
| Slido Professional | $50 | logo + custom theme |
| Wayground Enterprise | quote | full |

### Cheapest tier with full report export
| Platform | Tier | $/mo |
|---|---|---|
| Kahoot Bronze (edu) | $3 | report download |
| Mentimeter Basic (edu) | ~€11 | Excel/PDF/Image |
| Slido Engage | $12.50 | data exports |
| Wayground | not stated — share only |

### Cheapest tier with multi-host / team
| Platform | Tier | $/mo |
|---|---|---|
| Slido Engage | $12.50 | up to 5 members |
| Mentimeter Pro | ~€28 | collaborative workspace |
| Kahoot Bronze (edu) | $3 | individual only — team plans contact-sales |
| Wayground School/District | quote | co-teaching/teams |

### AI as paywall lever (most aggressive → least)
1. **Kahoot** — every paid tier leads with AI. Image gen is highest-tier-only.
2. **Wayground** — AI grading + small-group identification + admin chat with data are quote-only differentiators.
3. **Mentimeter** — AI on free, paid AI features not publicly enumerated.
4. **Slido** — only "AI Support Assistant" appears on pricing page; AI is not the lead message.

### Commercial/marketing use restrictions
- **Kahoot**: hard wall — only Pro Max ($69/mo) and Enterprise allow commercial use
- **Slido / Mentimeter / Wayground**: not gated as aggressively; check individual ToS before relying on this

### SSO/SCIM/LMS gating (universal pattern)
**All four platforms gate SSO + SCIM + LMS to Enterprise/quote-only.** No mid-tier shortcut.

---

## 6. Implications for BROADCAST

### Free tier scoping suggestions
- **Player cap**: Current `SOFT_CAP_FREE = 10` is far below market. Range 30-50 is industry-typical free; 50-100 if we want to undercut Kahoot's 40 specifically. `HARD_CAP = 150` is fine for academy use.
- **Question types on free**: At minimum quiz + true/false (Kahoot's free baseline). Adding poll/word-cloud on free would be a clear competitive lead vs Kahoot Free.
- **Reports on free**: Currently we ship full CSV export — that's competitive lead vs Kahoot's 3-row free limit, Wayground's "share only", Slido's no-export-on-free.
- **AI on free**: Mentimeter and Wayground both put AI on free. If we add AI quiz generation, free-tier inclusion is the differentiator.

### Pro tier scoping suggestions
- **Price anchor**: Mentimeter Pro at €28 (~$30) is the natural anchor for individual paid. Kahoot's Silver/Standard at $7-$25 is the educator-friendly band.
- **Headline features for Pro**: AI quiz generation (PDF-to-quiz, topic), custom branding, advanced reports, multi-host. Match Mentimeter's set roughly.
- **Player cap**: 200-1,000 (Mentimeter unlimited / Slido Pro 1,000 / Kahoot Plus 1,000).
- **Don't gate**: Basic question types, basic reports, basic save/load. Those are table-stakes everywhere now.

### Enterprise tier
- LMS integration (LTI 1.3), SSO, SCIM, reporting API — universal enterprise pattern.
- Quote-based pricing acceptable industry-wide.
- Match Kahoot/Mentimeter/Slido/Wayground here, no need to invent.

### Open lanes (positioning advantages)
1. **Cheap individual-teacher paid tier** — Wayground killed theirs, Kahoot starts at $3 with heavy gating. A $5-10/mo tier with full features could undercut.
2. **Generous free reports** — full CSV/per-answer export on free is strong differentiator.
3. **Permissive commercial use** — don't gate marketing use behind Max-tier wall like Kahoot does.
4. **No annual lock-in** — offer monthly billing if Mentimeter/Kahoot have killed it.
5. **Single-event pricing** — only Slido has this (one-time $80-$700 per event). Could be relevant for conferences.

### What to avoid
- Don't undercut so hard that the unit economics break. AI generation has real per-quiz cost (LLM tokens) — if AI is on free, throttle by quiz count or document length.
- Don't try to compete on "everything" — Wayground has 40M+ standards-aligned resources that took years to build. We can't.
- Don't ship enterprise features (SSO/SCIM/LTI) without contract revenue to support the maintenance burden.

---

## 7. Re-research checklist (when revisiting)

Before committing to BROADCAST pricing publicly, re-verify:
- [ ] Free-tier player caps (these have been dropping — Kahoot 50→40 in 2025/26)
- [ ] AI generation gating — fastest-moving feature category
- [ ] Annual-only vs monthly billing trends
- [ ] Education-tier pricing (often hidden/sales-led, but undercuts business)
- [ ] Commercial/marketing-use ToS restrictions (Kahoot Max is the only hard wall today)
- [ ] Whether Wayground reintroduces an individual-teacher paid tier
- [ ] Mentimeter API pricing (currently not stated publicly)
- [ ] One-time event pricing options across all platforms (Slido is the only one currently)

Re-run the same source pages: kahoot.com/schools/plans, kahoot360.com/pricing, slido.com/pricing, mentimeter.com/plans, wayground.com/home/plans, wayground.com/forbusiness/plans.
