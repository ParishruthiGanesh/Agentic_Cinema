import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import type { AgentContext } from "../agents/context.js";
import { CHILDREN_SCOPE } from "../persistence/repository.js";
import { ChildProfile, PICTURE_STYLES, StoryOutcome, type ChildProfileInput, type Project, type SocialStoryBrief, type StoryOutcomeInput, slugify } from "../model/index.js";
import type { CharacterReference } from "../media/generation.js";

/* ------------------------------------------------------------------ */
/* Child profiles: one canonical child, many stories                    */
/* ------------------------------------------------------------------ */

export function upsertChildProfile(ctx: AgentContext, input: ChildProfileInput): ChildProfile {
  const now = new Date().toISOString();
  const id = input.id ?? slugify(input.name);
  const existing = ctx.repo.getChild(id);
  const profile = ChildProfile.parse({ ...input, id, createdAt: existing?.createdAt ?? now, updatedAt: now });
  ctx.repo.saveChild(profile);
  void ctx.memory.recordChildProfile(profile).catch(() => undefined);
  return profile;
}

/** The visual style prompt for a child's stories (the child's choice, or an explicit override per story). */
export function visualStyleFor(child: ChildProfile, override?: "illustrated" | "photo"): string {
  return PICTURE_STYLES[override ?? child.style].prompt;
}

/** Stories created from a child's profile, newest first. */
export function storiesForChild(ctx: AgentContext, childId: string): Project[] {
  return ctx.repo.listProjects().filter((p) => p.childId === childId);
}

export interface StoryFromChildInput {
  situation: string;
  steps: SocialStoryBrief["steps"];
  /** Extra settings/people/items for this story, merged with the profile's familiar ones (profile wins on id clash). */
  settings?: SocialStoryBrief["settings"];
  companions?: SocialStoryBrief["companions"];
  comfortItems?: SocialStoryBrief["comfortItems"];
  mustNotShow?: string[];
  calmingRules?: string[];
  authoredBy?: string;
}

/** Build a story brief from the child's profile so identity, outfit, comfort items and companions are always the same. */
export function briefFromChild(child: ChildProfile, story: StoryFromChildInput): SocialStoryBrief {
  const mergeById = <T extends { id: string }>(base: T[], extra: T[] = []) => [...base, ...extra.filter((e) => !base.some((b) => b.id === e.id))];
  return {
    child: { name: child.name, age: child.age, appearance: child.appearance, outfit: child.outfit },
    situation: story.situation,
    companions: mergeById(child.companions, story.companions),
    comfortItems: mergeById(child.comfortItems, story.comfortItems),
    settings: mergeById(child.places, story.settings),
    steps: story.steps,
    mustNotShow: [...new Set([...child.mustNotShow, ...(story.mustNotShow ?? [])])],
    calmingRules: [...new Set([...child.calmingRules, ...(story.calmingRules ?? [])])],
    authoredBy: story.authoredBy ?? child.guardian,
  };
}

/* ------------------------------------------------------------------ */
/* Child photos: stored once, copied into every story as references     */
/* ------------------------------------------------------------------ */

export interface ChildPhoto {
  childId: string;
  /** character id (child or companion) or setting id */
  entityId: string;
  kind: "character" | "location";
  path: string;
  mimeType: string;
  uploadedAt: string;
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export async function saveChildPhoto(ctx: AgentContext, childId: string, entityId: string, kind: ChildPhoto["kind"], file: { mimeType: string; data: string }): Promise<ChildPhoto> {
  const child = ctx.repo.getChild(childId);
  if (!child) throw new Error(`Child ${childId} not found`);
  const known = kind === "character" ? slugify(child.name) === entityId || child.companions.some((c) => c.id === entityId) : child.places.some((p) => p.id === entityId);
  if (!known) throw new Error(`${entityId} is not part of ${child.name}'s profile`);
  if (!EXT[file.mimeType]) throw new Error(`Unsupported image type ${file.mimeType} (use PNG, JPEG or WebP)`);
  const bytes = Buffer.from(file.data, "base64");
  if (!bytes.length) throw new Error("Empty image");
  if (bytes.length > 8 * 1024 * 1024) throw new Error("Image larger than 8 MB");
  const path = `children/${childId}/${entityId}.${EXT[file.mimeType]}`;
  const full = join(ctx.config.mediaDir, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, bytes);
  const photo: ChildPhoto = { childId, entityId, kind, path, mimeType: file.mimeType, uploadedAt: new Date().toISOString() };
  ctx.repo.store.put("child_photos", CHILDREN_SCOPE, `${childId}:${entityId}`, photo);
  return photo;
}

export function listChildPhotos(ctx: AgentContext, childId: string): ChildPhoto[] {
  return ctx.repo.store.list<ChildPhoto>("child_photos", CHILDREN_SCOPE).filter((p) => p.childId === childId);
}

export function removeChildPhoto(ctx: AgentContext, childId: string, entityId: string): boolean {
  const key = `${childId}:${entityId}`;
  if (!ctx.repo.store.get("child_photos", CHILDREN_SCOPE, key)) return false;
  ctx.repo.store.delete("child_photos", CHILDREN_SCOPE, key);
  return true;
}

/** Copy the child's photos into a new story so they anchor identity and places there too. */
export async function applyChildReferences(ctx: AgentContext, project: Project): Promise<number> {
  if (!project.childId) return 0;
  const photos = listChildPhotos(ctx, project.childId);
  let n = 0;
  for (const photo of photos) {
    const dest = `${project.id}/references/${photo.entityId}_upload${extname(photo.path)}`;
    const full = join(ctx.config.mediaDir, dest);
    await mkdir(dirname(full), { recursive: true });
    try {
      await copyFile(join(ctx.config.mediaDir, photo.path), full);
    } catch {
      continue;
    }
    const ref: CharacterReference = { characterId: photo.entityId, path: dest, mimeType: photo.mimeType, prompt: "(photo from the child's profile)", provenance: { provider: "upload", model: "user-photo", task: "reference", createdAt: new Date().toISOString(), note: "Photo from the child's profile; used as the identity/place reference for every keyframe." } };
    ctx.repo.store.put(photo.kind === "character" ? "character_refs" : "location_refs", project.id, photo.entityId, ref);
    n += 1;
  }
  if (n) ctx.events.emit(project.id, "world_memory", "child.references.applied", `${n} photo${n === 1 ? "" : "s"} from ${project.childId}'s profile attached as references`, { childId: project.childId, count: n });
  return n;
}

/* ------------------------------------------------------------------ */
/* Outcomes: what happened after the real visit                         */
/* ------------------------------------------------------------------ */

export function recordOutcome(ctx: AgentContext, project: Project, input: StoryOutcomeInput): StoryOutcome {
  const outcome = StoryOutcome.parse({ ...input, id: `out_${Date.now().toString(36)}`, projectId: project.id, childId: project.childId, recordedAt: new Date().toISOString() });
  ctx.repo.saveOutcome(outcome);
  void ctx.memory.recordOutcome(outcome).catch(() => undefined);
  const anxious = outcome.stepNotes.filter((s) => s.reaction === "anxious").map((s) => s.stepNumber);
  ctx.events.emit(project.id, "user", "social_story.outcome", `${outcome.recordedBy} recorded the outcome: ${outcome.visitOutcome.replace(/_/g, " ")}, watched ${outcome.timesWatched}×${anxious.length ? `; anxious at step${anxious.length === 1 ? "" : "s"} ${anxious.join(", ")}` : ""}`, { outcomeId: outcome.id, visitOutcome: outcome.visitOutcome, timesWatched: outcome.timesWatched, anxiousSteps: anxious }, outcome.visitOutcome === "went_well" ? "success" : "warn");
  return outcome;
}

/** Everything the next version should know: the brief plus the notes the adult left per step. */
export function revisionSeed(ctx: AgentContext, project: Project): { brief: SocialStoryBrief; notes: Array<{ stepNumber: number; reaction: string; note?: string; recordedAt: string }>; outcomes: StoryOutcome[] } {
  if (!project.socialStory) throw new Error("Not a social story");
  const outcomes = ctx.repo.listOutcomes(project.id);
  const notes = outcomes.flatMap((o) => o.stepNotes.map((s) => ({ ...s, recordedAt: o.recordedAt })));
  return { brief: project.socialStory, notes, outcomes };
}
