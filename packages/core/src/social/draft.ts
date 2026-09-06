import type { LLMProvider, StructuredResult } from "../llm/provider.js";
import { SocialStoryDraftSchema, type SocialStoryDraft } from "./compile.js";

export interface DraftRequest {
  situation: string;
  childName: string;
  childAge?: string;
  /** Anything the therapist/parent wants the draft to include or avoid. */
  notes?: string;
  language?: string;
}

export const DRAFT_SYSTEM = `You help a therapist or parent draft a SOCIAL STORY for an autistic child: a short, first-person, step-by-step preview of a
situation (a dentist visit, the first day of school, a haircut) so that nothing on the day is a surprise.

Conventions (follow strictly):
- First person, present or near-future tense ("I will sit in the big chair."), literal and concrete. No metaphors, no jokes, no surprises.
- One idea per step. 5 to 8 steps that follow the real sequence of the situation, from getting ready to finishing.
- Positive and calm; describe what WILL happen and what the child CAN do. Never describe fear, pain or punishment.
- Each step names ONE setting (a room or place) and lists the people present by name.
- Include 2-4 "calming rules": things the child can do if something is hard ("If it is loud I can ask for headphones.").
- Suggest a must-not-show list: things that should never appear in the pictures (e.g. needles, drills, blood, crying faces).
- Suggest 1-2 comfort items the child may bring.
- Give each setting a short visual description and each companion a name, a role, an appearance and one outfit.
The adult will edit everything before it is used. Keep sentences short.`;

/** Gemini-assisted first draft of a routine. The adult edits it; the compiled film uses their final words verbatim. */
export async function draftSocialStory(llm: LLMProvider, req: DraftRequest): Promise<StructuredResult<SocialStoryDraft>> {
  return llm.generateStructured({
    task: "social_story_draft",
    system: DRAFT_SYSTEM,
    prompt: `CHILD: ${req.childName}${req.childAge ? `, age ${req.childAge}` : ""}
SITUATION: ${req.situation}
LANGUAGE: ${req.language ?? "English"}
${req.notes ? `NOTES FROM THE ADULT: ${req.notes}\n` : ""}
Draft the social story as JSON.`,
    schema: SocialStoryDraftSchema,
    temperature: 0.4,
  });
}
