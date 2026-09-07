import type { ChildProfileInput, CreateProjectInput, SocialStoryBrief } from "../model/index.js";
import { DEFAULT_SOCIAL_STORY_STYLE, renderSocialStoryText } from "../social/compile.js";

/**
 * "Maya goes to the dentist": an original social story written for this project.
 * Maya is a fictional child; nothing here is based on a real person.
 */
export const MAYA_SOCIAL_STORY: SocialStoryBrief = {
  child: {
    name: "Maya",
    age: "6",
    appearance: "a six-year-old girl with warm brown skin, curly black hair tied in two puffs with yellow bands, round cheeks and dark brown eyes",
    outfit: "a yellow t-shirt with one white star on the chest, blue leggings and white sneakers",
  },
  situation: "going to the dentist for a check-up",
  companions: [
    { id: "mum", name: "Mum", role: "parent", appearance: "a tall woman with warm brown skin and short black hair", outfit: "a green cardigan over a white top and dark jeans" },
    { id: "dr_lee", name: "Dr. Lee", role: "dentist", appearance: "a dentist with grey hair, round glasses and a friendly smile", outfit: "a white coat over a light blue shirt" },
  ],
  comfortItems: [{ id: "bun", name: "Bun", description: "a small grey plush rabbit with long floppy ears and a pink nose" }],
  settings: [
    { id: "hallway", name: "Home hallway", description: "a bright home hallway with a wooden front door, a coat hook and a small bench" },
    { id: "waiting_room", name: "Waiting room", description: "a calm dentist waiting room with soft blue chairs, a fish tank and a low table with books" },
    { id: "dentist_room", name: "Dentist room", description: "a clean, bright dentist room with a big blue reclining chair, a round lamp above it and a window with white blinds" },
  ],
  steps: [
    { title: "Getting ready", text: "Today I am going to the dentist. I put on my yellow star t-shirt and my white sneakers. I bring Bun with me.", settingId: "hallway", companionIds: ["mum"], comfortItemIds: ["bun"], visual: "Maya stands in the hallway by the front door holding Bun, ready to go. Mum waits beside her with the door open." },
    { title: "The waiting room", text: "At the dentist there is a waiting room. It has soft blue chairs and a fish tank. I sit next to Mum and hold Bun. We wait for my name.", settingId: "waiting_room", companionIds: ["mum"], comfortItemIds: ["bun"], visual: "Maya sits on a soft blue chair next to Mum, holding Bun, looking at the fish tank." },
    { title: "Meeting Dr. Lee", text: "Dr. Lee says hello. Dr. Lee has grey hair and round glasses and wears a white coat. Mum comes into the room with me.", settingId: "dentist_room", companionIds: ["mum", "dr_lee"], comfortItemIds: ["bun"], visual: "Dr. Lee smiles and waves hello at the door of the dentist room. Maya holds Bun and Mum's hand." },
    { title: "The big chair", text: "I sit in the big blue chair. The chair leans back slowly. That is okay. I can keep Bun on my lap.", settingId: "dentist_room", companionIds: ["mum", "dr_lee"], comfortItemIds: ["bun"], visual: "Maya sits in the big blue reclining chair with Bun on her lap. Mum sits on a stool beside her and Dr. Lee stands nearby." },
    { title: "Counting teeth", text: "Dr. Lee puts on blue gloves and uses a tiny mirror to count my teeth. I open my mouth wide like a lion. It does not hurt. If I need a break, I can raise my hand.", settingId: "dentist_room", companionIds: ["mum", "dr_lee"], comfortItemIds: ["bun"], visual: "Maya opens her mouth wide in the chair while Dr. Lee, wearing blue gloves, holds a tiny dental mirror. Bun is on Maya's lap and Mum is beside her." },
    { title: "All done", text: "When Dr. Lee is finished, I choose a sticker. I say goodbye to Dr. Lee.", settingId: "dentist_room", companionIds: ["mum", "dr_lee"], comfortItemIds: ["bun"], visual: "Maya stands by the chair holding Bun and a sheet of stickers, choosing one. Dr. Lee and Mum smile." },
    { title: "Going home", text: "Then Mum and I go home. I did it!", settingId: "hallway", companionIds: ["mum"], comfortItemIds: ["bun"], visual: "Maya and Mum walk in through the front door at home. Maya holds Bun up happily, a sticker on her t-shirt." },
  ],
  mustNotShow: ["needles or syringes", "dental drills", "blood", "crying or frightened faces"],
  calmingRules: ["If the light is too bright, I can close my eyes.", "If it is too loud, I can ask for my headphones."],
  authoredBy: "CineMemory team (fictional example)",
};

export const MAYA_DEMO_INPUT: CreateProjectInput = {
  title: "Maya goes to the dentist",
  mode: "social_story",
  source: {
    kind: "social_story",
    title: "Maya goes to the dentist (social story routine)",
    author: MAYA_SOCIAL_STORY.authoredBy,
    text: renderSocialStoryText(MAYA_SOCIAL_STORY),
    rightsNote: "Original example routine; Maya is fictional.",
  },
  brief: {
    genre: "social story",
    audience: "an autistic child",
    ageRange: "5-8",
    targetDurationSec: 90,
    language: "English",
    visualStyle: DEFAULT_SOCIAL_STORY_STYLE,
    tone: "calm, literal, reassuring",
    format: "social story film",
    requiredFacts: [],
  },
  socialStory: MAYA_SOCIAL_STORY,
};

export const SOCIAL_STORY_DEMO_ID = "maya_dentist_demo";
export const MAYA_CHILD_ID = "maya";

/** Maya's profile: the part of the story that stays the same across every situation. */
export const MAYA_CHILD_PROFILE: ChildProfileInput = {
  id: MAYA_CHILD_ID,
  name: MAYA_SOCIAL_STORY.child.name,
  age: MAYA_SOCIAL_STORY.child.age,
  appearance: MAYA_SOCIAL_STORY.child.appearance,
  outfit: MAYA_SOCIAL_STORY.child.outfit,
  comfortItems: MAYA_SOCIAL_STORY.comfortItems,
  companions: MAYA_SOCIAL_STORY.companions.filter((c) => c.id === "mum"),
  places: MAYA_SOCIAL_STORY.settings.filter((s) => s.id === "hallway"),
  mustNotShow: ["crying or frightened faces"],
  calmingRules: MAYA_SOCIAL_STORY.calmingRules,
  sensory: { reducedMotion: true, sound: "on", showText: true, largeText: true, pacing: "slow", notes: "Loud sudden sounds are hard; likes to tap to go on herself." },
  style: "illustrated",
  guardian: "Mum (fictional example)",
  notes: "Fictional child used for the CineMemory demo.",
};
