import type { SocialStoryBrief } from "../model/index.js";

/**
 * Plain-language critic for social stories. Deterministic checks a therapist would make by hand:
 * first person, short sentences, present or near-future tense, positive phrasing, no idioms, one idea per step.
 * Findings are advice, never blocking: the adult owns the words.
 */
export type LanguageRule = "first_person" | "long_sentence" | "too_many_ideas" | "negative_phrasing" | "past_tense" | "idiom" | "question" | "vague_pronoun";

export interface LanguageFinding {
  step: number;
  rule: LanguageRule;
  severity: "low" | "medium";
  message: string;
  /** The sentence or phrase that triggered the finding. */
  excerpt: string;
}

export interface LanguageStepReport {
  step: number;
  sentences: number;
  longestSentenceWords: number;
  findings: LanguageFinding[];
}

export interface LanguageReport {
  steps: LanguageStepReport[];
  findings: LanguageFinding[];
  summary: { steps: number; stepsClean: number; findings: number; medium: number; low: number };
}

const IDIOMS = ["piece of cake", "hold your horses", "in a nutshell", "hang on", "break a leg", "under the weather", "keep an eye", "hit the road", "on the same page", "cold feet", "raining cats", "give it a shot", "no big deal", "sit tight", "over the moon", "butterflies in"];
const NEGATIVE = /\b(don't|do not|can't|cannot|won't|mustn't|must not|shouldn't|should not|never|nobody|no one|not allowed)\b/i;
const PAST = /\b(was|were|went|had|did|saw|felt|came|took|got)\b/i;
const FIRST_PERSON = /(^|[^A-Za-z])(I|I'm|I'll|I've|my|me|we|our|us)([^A-Za-z]|$)/;
const MAX_WORDS = 14;
const MAX_SENTENCES = 4;

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

export function checkStepText(step: number, text: string): LanguageStepReport {
  const findings: LanguageFinding[] = [];
  const sentences = splitSentences(text);
  const longest = sentences.reduce((m, s) => Math.max(m, words(s)), 0);
  if (!FIRST_PERSON.test(text)) findings.push({ step, rule: "first_person", severity: "medium", message: "Social stories are written in the child's voice: use I, my, me or we.", excerpt: sentences[0] ?? text });
  for (const s of sentences) {
    if (words(s) > MAX_WORDS) findings.push({ step, rule: "long_sentence", severity: "low", message: `Sentence has ${words(s)} words; ${MAX_WORDS} or fewer is easier to follow.`, excerpt: s });
    const neg = NEGATIVE.exec(s);
    if (neg) findings.push({ step, rule: "negative_phrasing", severity: "low", message: `"${neg[0]}" describes what will not happen; say what will happen instead.`, excerpt: s });
    if (PAST.test(s) && !/\bI did it\b/i.test(s)) findings.push({ step, rule: "past_tense", severity: "low", message: "Use present or near-future tense: this previews what will happen.", excerpt: s });
    if (s.includes("?")) findings.push({ step, rule: "question", severity: "low", message: "A question can feel like a test; state it instead.", excerpt: s });
    if (/^(It|They|This|That)\b/.test(s) && sentences.indexOf(s) === 0) findings.push({ step, rule: "vague_pronoun", severity: "low", message: "Start the step by naming the thing, not with it/they/this.", excerpt: s });
  }
  const lower = text.toLowerCase();
  for (const idiom of IDIOMS) if (lower.includes(idiom)) findings.push({ step, rule: "idiom", severity: "medium", message: `"${idiom}" is an idiom; many autistic children read literally.`, excerpt: idiom });
  if (sentences.length > MAX_SENTENCES) findings.push({ step, rule: "too_many_ideas", severity: "low", message: `${sentences.length} sentences in one step; consider splitting so each step has one idea.`, excerpt: `${sentences.length} sentences` });
  return { step, sentences: sentences.length, longestSentenceWords: longest, findings };
}

export function checkPlainLanguage(brief: Pick<SocialStoryBrief, "steps" | "calmingRules">): LanguageReport {
  const steps = brief.steps.map((s, i) => checkStepText(i + 1, s.text));
  const rules = brief.calmingRules.map((r, i) => checkStepText(brief.steps.length + i + 1, r));
  const all = [...steps, ...rules];
  const findings = all.flatMap((s) => s.findings);
  return {
    steps: all,
    findings,
    summary: { steps: all.length, stepsClean: all.filter((s) => s.findings.length === 0).length, findings: findings.length, medium: findings.filter((f) => f.severity === "medium").length, low: findings.filter((f) => f.severity === "low").length },
  };
}
