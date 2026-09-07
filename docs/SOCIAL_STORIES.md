# Social stories: continuity as the product

## Who this is for

Social stories are short, first-person, step-by-step previews of a situation ("Today I am going to the dentist. I will sit in the big chair. The chair leans back slowly. That is okay.") written by speech and language therapists, occupational therapists, special-education teachers and parents for autistic children. They rehearse a fixed sequence so that nothing on the day is a surprise. They are among the most widely used supports in autism care and are still mostly paper booklets with clip art.

A social story only works if it matches reality **and matches itself**. Many autistic children notice and remember details strongly and find unexpected change distressing. If scene 3 shows the child in a red shirt and scene 4 in green, if the dentist's chair changes shape, or if the sticker comes before the tooth counting, the story teaches the wrong script and can raise anxiety instead of lowering it. That is exactly what image generators do badly, which is why therapists cannot use generic AI video tools for this.

## What CineMemory does differently

| Concern | How the social-story mode handles it |
|---|---|
| The words must be exact | The routine is **compiled**, not adapted. Each step becomes one scene with the authored text verbatim (`compileSocialStoryScreenplay`). No model rewrites it; the certificate reports `wordsUnchanged`. |
| The order must be fixed | Each step is an essential event depending on the previous one. The Narrative Critic checks chronology and dependencies; the certificate reports `sequence.ordered`. |
| Same child, same clothes | The child's appearance and the **one** outfit are critical visual constraints injected into every image prompt and inspected on every generated frame (`CHARACTER_IDENTITY_DRIFT`, `CLOTHING_MISMATCH`). |
| Same rooms, same people, same comfort item | Settings, companions and comfort items are locked the same way (`LOCATION_MISMATCH`, `PROP_MISSING`). |
| Nothing frightening | The must-not-show list becomes absence constraints (`must_not_show_n`, code `FORBIDDEN_CONTENT`), added to the negative prompt and verified by the vision model on each frame. |
| Calm, literal pictures | Shot planning is deterministic: one static, eye-level shot per step. The Director LLM is deliberately not used, because reinterpretation is the failure mode. |
| Drift gets fixed | The Repair Agent regenerates a failing frame and the Visual Critic re-inspects it (bounded attempts, escalation to the adult). |
| A person decides | The **Continuity Certificate** shows, per step, what was verified and what was repaired. A therapist or parent signs it; approval is tied to the picture versions and is invalidated by any regeneration. |

## Built for the child, not just the film

| Need | What exists |
|---|---|
| **One child, many stories** | A child profile (look, the one outfit, comfort items, familiar people and places, must-not-show list, calming rules, sensory preferences) stored once. Every story starts from it (`briefFromChild`), so Maya, Bun and Mum are the same at the dentist in March and the hairdresser in June. Profiles and outcomes are versioned in ClickHouse (`child_profiles`, `story_outcomes`); the profile page shows the longitudinal history and the SQL behind it. |
| **The child never sees the workspace** | `/watch/<story>`: one picture, the child's own words, one big Next button, Again, Back. No timeline, no cuts, no autoplay unless the profile says so. The sensory profile sets motion, voice, words, text size and pacing automatically; only approved stories open without `?preview=1`. |
| **Real places** | Upload a photo of the actual waiting room or classroom (profile or Characters page). It is passed to the image model as the setting reference the same way a photo of the child anchors identity, and it is listed on the certificate. |
| **The words themselves** | A plain-language critic (`checkPlainLanguage`) checks each step as it is typed and again on the certificate: first person, sentence length, present tense, negatives, idioms, questions, one idea per step. Advice only; the adult owns the words. |
| **Paper** | `GET /api/projects/<id>/booklet.pdf`: cover with certificate status and sign-off, one verified picture per page with the step text (large text if the profile asks), calming rules at the end. |
| **After the real visit** | The adult records times watched, how the visit went and a reaction per step. Stored with the story and in ClickHouse under the child. "Revise from feedback" opens the form preloaded with the story and the notes, and the new story records which one it revises. |
| **Gemini composes each picture** | With a key, a Director call proposes the composition of every step from the retrieved state and the step text (static, eye level, whole figures, nothing added); the words, cast, props, outfit and must-not-show list stay locked and the Visual Critic verifies the result. Without a key, a literal composition from the step text is used and stamped as deterministic. |

## Where Gemini and ClickHouse are used

- **Gemini** (`@google/genai`): optional first draft of the routine (`POST /api/social-stories/draft`, task `social_story_draft`); reference sheets and keyframes (`gemini-3.1-flash-image`, with uploaded photos as references when provided); voice (`gemini-2.5-flash-preview-tts`); vision inspection of every frame (`gemini-3.6-flash`, task `visual_inspection`).
- **ClickHouse**: every constraint, shot, check, violation, repair attempt, generation attempt and model call is recorded; the certificate's memory row count and the Memory page come from there.
- **ADK Producer agent**: `create_social_story_demo` and `get_continuity_certificate` tools; the agent can run the story to `film_assembled` and explain what blocks approval, but cannot approve.

## Personalised references

On the Characters page (or in the creation form) upload a photo or drawing of the child or a companion. It is stored under `data/media/<project>/references/` and passed to the image model as the identity reference for every keyframe with that person; it is never overwritten by a generated sheet. Only upload photos you have consent to use; they are sent to the image model with each generation request.

Honest caveat: image models still struggle to reproduce a specific real face consistently. The practical product path is a stylised avatar derived from the photo, with real photographs of the actual clinic or classroom as backgrounds; the verification loop is the same either way.

## Demo: "Maya goes to the dentist"

Maya is fictional. Seven steps, three settings (home hallway, waiting room, dentist room), two companions (Mum, Dr. Lee), one comfort item (Bun, a grey plush rabbit), four must-not-show items (needles or syringes, dental drills, blood, crying or frightened faces), two calming rules.

```bash
pnpm --filter @cinememory/api exec tsx src/cli.ts seed-social film_assembled   # or "Social story demo" on the dashboard
pnpm --filter @cinememory/api exec tsx src/cli.ts certificate maya_dentist_demo
```

Offline (no key) the story path still runs end to end with placeholder cards; the certificate then reports `incomplete` with the reason "pictures are development placeholders" and approval is blocked unless forced with a note. See DEMO.md for the measured live run.

## API

| Route | Purpose |
|---|---|
| `POST /api/projects` with `mode: "social_story"` and `socialStory` | create from a brief (validated: every step's setting, companions and items must exist) |
| `POST /api/projects/social-story-demo` | Maya demo |
| `GET /api/social-stories/example` | the Maya brief, for the form |
| `POST /api/social-stories/draft` | Gemini first draft (503 without a key) |
| `POST/DELETE /api/projects/:id/references/:characterId` | upload / remove a reference photo (base64 JSON, PNG/JPEG/WebP, ≤ 8 MB) |
| `GET /api/projects/:id/certificate` | Continuity Certificate (incl. plain-language report, outcomes, references) |
| `GET /api/projects/:id/booklet.pdf` | printable booklet |
| `GET/POST /api/projects/:id/outcomes` | what happened after the real visit |
| `GET /api/projects/:id/revision-seed` | brief + per-step notes for the next version |
| `GET/POST /api/children`, `GET/PUT/DELETE /api/children/:id` | child profiles |
| `POST /api/children/:id/photos/:entityId` | photo of the child, a companion or a familiar place |
| `POST /api/children/:id/brief` | merge the profile with story-specific steps |
| `POST /api/social-stories/lint` | plain-language critic |
| `POST /api/projects/:id/approve` `{approvedBy, note?, force?}` | sign-off; 409 unless verified (or `force` with a note) |
| `DELETE /api/projects/:id/approve` | revoke |

## Limitations

- The vision model is the judge of the pictures. It is strict on some things and can miss subtle ones; the certificate says which checks ran and the adult's review is the final check.
- Keyframes plus voice, not video, until Veo is enabled (`ENABLE_VIDEO_GENERATION=true`).
- One outfit and static shots are enforced by construction, not configurable per step, on purpose.
- Not a clinical tool. CineMemory illustrates and verifies the routine that a person who knows the child wrote; it does not write the therapy.
