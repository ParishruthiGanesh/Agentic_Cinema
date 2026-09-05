/**
 * DEVELOPMENT FIXTURES for the bundled demo project.
 *
 * These are authored structured outputs that stand in for Gemini responses when no credentials are
 * configured (LLM_PROVIDER=fixture). They are validated against the same schemas as live model output,
 * stamped provider="fixture" everywhere, and exist so the deterministic parts of CineMemory (memory,
 * critics, repair, evaluation, UI) can be exercised and tested offline.
 *
 * The screenplay fixture intentionally contains two faults so the critics have something real to catch:
 *   1. Milo references the compass secret in Scene 4, before Lumi tells him in Scene 5 (KNOWLEDGE_TIMELINE_VIOLATION).
 *   2. The required educational fact (bioluminescence) is absent (REQUIRED_FACT_MISSING).
 */
import type { SourceAnalysisOutput } from "../agents/sourceIntelligence.js";
import type { AdaptationOutput } from "../agents/adaptation.js";
import type { ScreenplayOutput } from "../agents/screenplay.js";
import type { ScenePlanOutput } from "../agents/director.js";

export const SOURCE_ANALYSIS: SourceAnalysisOutput = {
  characters: [
    {
      id: "lumi",
      name: "Lumi",
      role: "protagonist",
      description: "A small firefly who is afraid of the dark and hides her glow at night.",
      appearance: { species: "firefly", age: "child", build: "tiny", distinguishingFeatures: ["warm yellow glow", "translucent wings", "big hopeful eyes"], summary: "a tiny firefly with a warm yellow glow, translucent wings and big hopeful eyes" },
      clothing: { items: ["tiny blue scarf"], colors: ["blue"], summary: "a tiny blue knitted scarf" },
      voice: { description: "small, bright and a little breathless", pitch: "high", pace: "quick" },
      personality: ["timid", "kind", "brave when it counts"],
      goals: ["bring her friends home"],
      fears: ["the dark"],
      initialLocationId: "willow_meadow",
      initialEmotionalState: "anxious",
      sourceEvidence: "a small firefly named Lumi. She had a warm yellow glow and wore a tiny blue scarf ... Lumi was afraid of the dark.",
    },
    {
      id: "milo",
      name: "Milo",
      role: "supporting",
      description: "A young rabbit, Lumi's best friend, who carries his grandfather's broken compass in his satchel.",
      appearance: { species: "rabbit", age: "child", build: "small and long-legged", distinguishingFeatures: ["long ears", "soft grey-brown fur"], summary: "a young rabbit with long ears and soft grey-brown fur" },
      clothing: { items: ["green satchel"], colors: ["green"], summary: "a green cloth satchel worn across the chest" },
      voice: { description: "warm and eager", pitch: "medium", pace: "medium" },
      personality: ["loyal", "optimistic", "a little careless"],
      goals: ["find Pip", "get home"],
      fears: ["losing his grandfather's compass"],
      initialLocationId: "willow_meadow",
      initialEmotionalState: "cheerful",
      sourceEvidence: "Milo, a young rabbit with long ears and a green satchel he carried everywhere",
    },
    {
      id: "pip",
      name: "Pip",
      role: "supporting",
      description: "A small hedgehog who collects shiny pebbles and hurts his paw in the Dark Hollow.",
      appearance: { species: "hedgehog", age: "child", build: "small and round", distinguishingFeatures: ["soft brown spines", "button nose"], summary: "a small round hedgehog with soft brown spines and a button nose" },
      clothing: { items: [], colors: [], summary: "no clothing" },
      voice: { description: "soft and squeaky", pitch: "high", pace: "slow" },
      personality: ["gentle", "curious"],
      goals: ["get home safely"],
      fears: ["being left alone"],
      initialLocationId: "willow_meadow",
      initialEmotionalState: "content",
      sourceEvidence: "Pip, a small hedgehog who collected shiny pebbles",
    },
  ],
  locations: [
    { id: "willow_meadow", name: "Willow Meadow", description: "A sunny meadow of tall grass and bluebells where the friends live.", visualSummary: "open meadow with tall grass, bluebells and a willow tree, twilight sky", timeOfDayDefault: "dusk", keyFeatures: ["bluebells", "tall grass", "willow tree"], connectedTo: ["meadow_edge"], sourceEvidence: "At the edge of Willow Meadow lived a small firefly" },
    { id: "meadow_edge", name: "Meadow's Edge", description: "The grassy border between the meadow and the woods where the compass falls.", visualSummary: "long grass giving way to dark tree trunks, a glint of brass in the grass", timeOfDayDefault: "night", keyFeatures: ["grass border", "first tree trunks"], connectedTo: ["willow_meadow", "dark_hollow"], sourceEvidence: "fell into the grass at the meadow's edge" },
    { id: "dark_hollow", name: "Dark Hollow", description: "A part of the forest where trees grow so close the path disappears.", visualSummary: "dense dark forest, close twisted trunks, deep blue shadows, faint moonlight", timeOfDayDefault: "night", keyFeatures: ["twisted trunks", "roots", "no visible path"], connectedTo: ["meadow_edge", "old_stump"], sourceEvidence: "In the Dark Hollow, the trees grew so close together that Milo and Pip could not see the path" },
    { id: "old_stump", name: "Old Stump", description: "A mossy stump deep in the hollow where Pip waits.", visualSummary: "a wide mossy tree stump in a small dark clearing", timeOfDayDefault: "night", keyFeatures: ["moss", "roots"], connectedTo: ["dark_hollow"], sourceEvidence: "Milo helped him to an old stump" },
  ],
  props: [
    { id: "broken_compass", name: "broken compass", description: "Milo's grandfather's brass compass with cracked glass; its needle wobbles instead of pointing north.", visualSummary: "an old brass pocket compass with cracked glass and a wobbling needle", significance: "Its secret (the needle points to the brightest light) is the key to getting home.", initialOwner: "milo", sourceEvidence: "his grandfather's old brass compass. Its glass was cracked and its needle spun and wobbled" },
  ],
  events: [
    { id: "ev_dusk_fear", name: "Lumi hides from the dusk", description: "At sunset Lumi refuses to join her friends and dims her glow.", order: 1, participants: ["lumi", "milo", "pip"], location: "willow_meadow", dependsOn: [], consequences: ["Lumi stays behind"], importance: "essential", sourceEvidence: "It's getting dark, she whispered, and she hid her glow." },
    { id: "ev_compass_dropped", name: "The compass falls from Milo's satchel", description: "As Milo leaves, the compass slips out at the meadow's edge unnoticed.", order: 2, participants: ["milo"], location: "meadow_edge", dependsOn: ["ev_dusk_fear"], consequences: ["compass lies in the grass"], importance: "essential", sourceEvidence: "the broken compass slipped from his satchel and fell into the grass at the meadow's edge" },
    { id: "ev_friends_lost", name: "Milo and Pip get lost", description: "Night falls in the Dark Hollow; Pip hurts his paw and waits at the old stump while Milo searches.", order: 3, participants: ["milo", "pip"], location: "dark_hollow", dependsOn: ["ev_compass_dropped"], consequences: ["Pip alone at the stump", "Milo searching"], importance: "essential", sourceEvidence: "They were lost. Pip had hurt his paw ... Wait here, said Milo." },
    { id: "ev_secret_discovered", name: "Lumi discovers the compass secret", description: "Lumi finds the compass and sees the needle follow her glow: it points to the brightest light.", order: 4, participants: ["lumi"], location: "meadow_edge", dependsOn: ["ev_compass_dropped"], consequences: ["Lumi alone knows the secret"], importance: "essential", sourceEvidence: "It points to the brightest light! ... for now only Lumi knew it." },
    { id: "ev_lumi_enters_dark", name: "Lumi flies into the dark", description: "Despite her fear Lumi shines bright and enters the hollow to find her friends.", order: 5, participants: ["lumi"], location: "dark_hollow", dependsOn: ["ev_secret_discovered"], consequences: ["Lumi finds Milo"], importance: "essential", sourceEvidence: "took a deep breath, and let her glow shine as bright as she could. Then she flew into the dark." },
    { id: "ev_secret_shared", name: "Lumi tells Milo the secret", description: "Lumi explains that the needle points to light, and Milo realises her glow can guide them.", order: 6, participants: ["lumi", "milo"], location: "dark_hollow", dependsOn: ["ev_lumi_enters_dark", "ev_secret_discovered"], consequences: ["Milo knows the secret", "plan to follow Lumi's light"], importance: "essential", sourceEvidence: "Lumi told him the secret: Your compass isn't broken, Milo. Its needle points to light. To me!" },
    { id: "ev_guided_home", name: "The friends follow Lumi's light home", description: "Lumi flies above the trees and glows; Milo follows the needle to Pip and then home.", order: 7, participants: ["lumi", "milo", "pip"], location: "willow_meadow", dependsOn: ["ev_secret_shared"], consequences: ["everyone home", "Lumi no longer afraid"], importance: "essential", sourceEvidence: "Milo followed the needle to the old stump, found Pip, and together they followed it all the way back" },
  ],
  relationships: [
    { from: "lumi", to: "milo", type: "best friends", description: "Lumi and Milo are best friends.", sentiment: "positive" },
    { from: "lumi", to: "pip", type: "friends", description: "Pip is Lumi's friend.", sentiment: "positive" },
    { from: "milo", to: "pip", type: "friends", description: "Milo looks after Pip.", sentiment: "positive" },
  ],
  knowledgeFacts: [
    {
      id: "fact_compass_points_to_light",
      statement: "The broken compass's needle points to the brightest light, not north.",
      isSecret: true,
      triggerPhrases: ["points to light", "points to the light", "points toward light", "points to the brightest", "brightest light", "follows the light", "follows your light", "needle follows", "isn't broken"],
      initialHolders: [],
      laterLearners: [
        { characterId: "lumi", via: "discovers it when the needle follows her glow" },
        { characterId: "milo", via: "Lumi tells him in the Dark Hollow" },
      ],
      sourceEvidence: "It points to the brightest light! ... That was the compass's secret, and for now only Lumi knew it.",
    },
  ],
  sourceConstraints: [
    { id: "sc_lumi_fear_arc", kind: "character_trait", statement: "Lumi starts afraid of the dark and ends unafraid.", importance: "must_keep", keywords: ["afraid", "not afraid", "scared"], relatedEntities: ["lumi"], sourceEvidence: "Lumi was afraid of the dark ... and she was not afraid." },
    { id: "sc_secret_order", kind: "causal_dependency", statement: "Lumi must discover the compass secret before she shares it with Milo.", importance: "must_keep", keywords: [], relatedEntities: ["ev_secret_discovered", "ev_secret_shared"], sourceEvidence: "for now only Lumi knew it ... Lumi told him the secret" },
    { id: "sc_guided_home", kind: "required_event", statement: "The friends get home by following Lumi's light with the compass.", importance: "must_keep", keywords: [], relatedEntities: ["ev_guided_home"], sourceEvidence: "together they followed it all the way back to Willow Meadow" },
    { id: "edu_bioluminescence", kind: "educational_fact", statement: "Fireflies make their own light inside their bodies; this is called bioluminescence.", importance: "must_keep", keywords: ["bioluminescence", "make their own light", "makes her own light", "make our own light"], relatedEntities: ["lumi"], sourceEvidence: "production brief: required fact" },
    { id: "sc_theme_light_in_dark", kind: "theme", statement: "The dark is only a place where your light can shine.", importance: "should_keep", keywords: ["light can shine", "where my light", "only a place"], relatedEntities: ["lumi"], sourceEvidence: "The dark, she had learned, was only a place where her light could shine." },
  ],
  visualConstraints: [
    { entityType: "character", entityId: "lumi", attribute: "scarf", value: "tiny blue scarf", severity: "high", promptKeywords: ["blue scarf"] },
    { entityType: "character", entityId: "lumi", attribute: "glow color", value: "warm yellow glow", severity: "high", promptKeywords: ["warm yellow glow", "yellow glow"] },
    { entityType: "character", entityId: "milo", attribute: "satchel", value: "green satchel", severity: "high", promptKeywords: ["green satchel"] },
    { entityType: "character", entityId: "milo", attribute: "ears", value: "long rabbit ears", severity: "medium", promptKeywords: ["long ears"] },
    { entityType: "prop", entityId: "broken_compass", attribute: "look", value: "brass compass with cracked glass", severity: "high", promptKeywords: ["brass", "cracked glass"] },
    { entityType: "style", entityId: "style", attribute: "art style", value: "soft painterly 2D children's animation", severity: "medium", promptKeywords: ["painterly", "children's animation"] },
  ],
  continuityConstraints: [
    { kind: "prop_possession", statement: "The compass is with Milo until it falls at the meadow's edge, then with Lumi after she finds it, then with Milo after she gives it to him.", entities: ["broken_compass", "milo", "lumi"], severity: "high" },
    { kind: "time_of_day", statement: "Scenes after the opening happen at night; the sky must not become daylight before the ending.", entities: [], severity: "medium" },
  ],
  themes: ["courage", "friendship", "your light matters most in the dark"],
  timeline: ["dusk at Willow Meadow", "night in the Dark Hollow", "Lumi finds the compass", "Lumi enters the dark", "the secret is shared", "the way home"],
  styleGuide: "Soft painterly 2D children's animation; twilight blues and purples contrasted with Lumi's warm yellow glow; rounded, friendly character shapes; no harsh shadows on faces.",
};

export const ADAPTATION: AdaptationOutput = {
  logline: "A firefly afraid of the dark discovers that her own light is the only thing that can guide her lost friends home.",
  synopsis: "At dusk Lumi hides her glow while Milo and Pip head for the blackberry bushes; Milo's broken compass falls at the meadow's edge. Night falls and the friends get lost in the Dark Hollow. Lumi finds the compass and discovers its needle points to the brightest light: her. She braves the dark, finds Milo, tells him the secret, and flies high so the needle can guide Milo and Pip home.",
  estimatedSceneCount: 6,
  mustKeep: [
    { entityId: "lumi", entityType: "character", reason: "protagonist; sc_lumi_fear_arc" },
    { entityId: "milo", entityType: "character", reason: "receives the secret; sc_secret_order" },
    { entityId: "pip", entityType: "character", reason: "the friend who must be rescued" },
    { entityId: "broken_compass", entityType: "prop", reason: "central device" },
    { entityId: "ev_secret_discovered", entityType: "event", reason: "sc_secret_order" },
    { entityId: "ev_secret_shared", entityType: "event", reason: "sc_secret_order" },
    { entityId: "ev_guided_home", entityType: "event", reason: "sc_guided_home" },
    { entityId: "fact_compass_points_to_light", entityType: "fact", reason: "the secret drives the plot" },
  ],
  removed: [],
  compressed: [{ entityId: "ev_friends_lost", entityType: "event", how: "one short scene establishes both the lost friends and Pip waiting at the stump" }],
  merged: [],
  unbreakableChains: [{ events: ["ev_compass_dropped", "ev_secret_discovered", "ev_secret_shared", "ev_guided_home"], reason: "the secret cannot be shared before it is discovered, and the rescue depends on it" }],
  audienceNotes: "Ages 6-9: simple sentences, gentle stakes, clear cause and effect, reassuring ending.",
  toneNotes: "Warm and a little magical; the dark is mysterious, never frightening.",
  beatSheet: [
    { beat: "Dusk at Willow Meadow: Lumi hides her glow; Milo and Pip leave for blackberries; the compass falls unnoticed.", eventIds: ["ev_dusk_fear", "ev_compass_dropped"], characterIds: ["lumi", "milo", "pip"], locationId: "willow_meadow", approxDurationSec: 12 },
    { beat: "Night in the Dark Hollow: Milo and Pip are lost; Pip hurts his paw and waits at the old stump.", eventIds: ["ev_friends_lost"], characterIds: ["milo", "pip"], locationId: "dark_hollow", approxDurationSec: 12 },
    { beat: "Lumi finds the compass at the meadow's edge and discovers the needle follows her glow.", eventIds: ["ev_secret_discovered"], characterIds: ["lumi"], locationId: "meadow_edge", approxDurationSec: 14 },
    { beat: "Lumi shines bright and flies into the dark; she finds Milo.", eventIds: ["ev_lumi_enters_dark"], characterIds: ["lumi", "milo"], locationId: "dark_hollow", approxDurationSec: 12 },
    { beat: "Lumi tells Milo the secret; they plan to use her light.", eventIds: ["ev_secret_shared"], characterIds: ["lumi", "milo"], locationId: "dark_hollow", approxDurationSec: 12 },
    { beat: "Lumi flies high and glows; Milo follows the needle to Pip and home; Lumi is no longer afraid.", eventIds: ["ev_guided_home"], characterIds: ["lumi", "milo", "pip"], locationId: "old_stump", approxDurationSec: 13 },
  ],
};

export const SCREENPLAY: ScreenplayOutput = {
  title: "Lumi and the Broken Compass",
  logline: "A firefly afraid of the dark discovers that her own light can guide her lost friends home.",
  acts: [
    { number: 1, title: "Dusk", purpose: "Lumi's fear and the lost compass" },
    { number: 2, title: "The Dark", purpose: "Lost friends, a secret discovered, courage found" },
    { number: 3, title: "The Light", purpose: "The secret shared and the way home" },
  ],
  scenes: [
    {
      number: 1, act: 1, title: "Hiding the Glow", locationId: "willow_meadow", timeOfDay: "dusk",
      objective: "Show Lumi's fear of the dark as her friends leave; the compass falls unnoticed.",
      emotionalState: "wistful", characterIds: ["lumi", "milo", "pip"], propIds: ["broken_compass"], eventIds: ["ev_dusk_fear", "ev_compass_dropped"], durationSec: 12,
      lines: [
        { type: "narration", text: "At the edge of Willow Meadow lived a little firefly named Lumi." },
        { type: "dialogue", characterId: "milo", text: "Come with us, Lumi! The blackberries are ripe!", emotion: "excited" },
        { type: "dialogue", characterId: "lumi", text: "It's getting dark. I... I'll wait here.", emotion: "anxious" },
        { type: "action", text: "Lumi dims her glow and slips inside a bluebell. Milo hops after Pip; the brass compass slides out of his green satchel into the grass. Nobody notices." },
      ],
      knowledgeReveals: [], propTransfers: [{ propId: "broken_compass", fromCharacterId: "milo", how: "slips from his satchel into the grass at the meadow's edge" }],
      exitLocations: { milo: "dark_hollow", pip: "dark_hollow" }, endEmotions: { lumi: "afraid", milo: "cheerful", pip: "cheerful" }, satisfiesConstraints: ["sc_lumi_fear_arc"],
    },
    {
      number: 2, act: 2, title: "Lost", locationId: "dark_hollow", timeOfDay: "night",
      objective: "Milo and Pip are lost; Pip hurts his paw and waits at the old stump.",
      emotionalState: "worried", characterIds: ["milo", "pip"], propIds: [], eventIds: ["ev_friends_lost"], durationSec: 12,
      lines: [
        { type: "action", text: "Twisted trunks crowd together. Pip limps, holding his paw." },
        { type: "dialogue", characterId: "pip", text: "Milo... every tree looks the same.", emotion: "scared" },
        { type: "dialogue", characterId: "milo", text: "Rest on this stump, Pip. I'll find the path. I promise.", emotion: "determined" },
        { type: "action", text: "Milo hops into the dark, calling Pip's name as it swallows him." },
      ],
      knowledgeReveals: [], propTransfers: [], exitLocations: { pip: "old_stump" }, endEmotions: { milo: "worried", pip: "lonely" }, satisfiesConstraints: [],
    },
    {
      number: 3, act: 2, title: "The Needle Turns", locationId: "meadow_edge", timeOfDay: "night",
      objective: "Lumi finds the compass and discovers its needle follows her glow.",
      emotionalState: "wonder", characterIds: ["lumi"], propIds: ["broken_compass"], eventIds: ["ev_secret_discovered"], durationSec: 14,
      lines: [
        { type: "narration", text: "Her friends did not come home. Then Lumi saw something glint in the grass." },
        { type: "action", text: "Lumi hovers over the brass compass. The wobbling needle stops and swings toward her. She darts left; it follows. Right; it follows." },
        { type: "dialogue", characterId: "lumi", text: "It doesn't point north at all. It points to the brightest light... it points to me!", emotion: "amazed" },
        { type: "action", text: "Lumi looks toward the Dark Hollow, takes a deep breath, gathers the compass in her arms and lets her glow blaze." },
      ],
      knowledgeReveals: [{ factId: "fact_compass_points_to_light", toCharacterId: "lumi", via: "the needle follows her glow" }],
      propTransfers: [{ propId: "broken_compass", toCharacterId: "lumi", how: "picks it up from the grass" }],
      exitLocations: { lumi: "dark_hollow" }, endEmotions: { lumi: "brave" }, satisfiesConstraints: [],
    },
    {
      number: 4, act: 2, title: "Into the Dark", locationId: "dark_hollow", timeOfDay: "night",
      objective: "Lumi braves the hollow and finds Milo.",
      emotionalState: "tense relief", characterIds: ["lumi", "milo"], propIds: ["broken_compass"], eventIds: ["ev_lumi_enters_dark"], durationSec: 12,
      lines: [
        { type: "action", text: "A small warm light moves between the black trunks: Lumi, scarf fluttering, compass held tight." },
        { type: "dialogue", characterId: "lumi", text: "Milo? Milo, where are you?", emotion: "nervous" },
        { type: "dialogue", characterId: "milo", text: "Lumi! You came! Your glow... the needle follows the light, doesn't it? Give it here!", emotion: "overjoyed" },
        { type: "dialogue", characterId: "lumi", text: "I was so scared. But you were in here.", emotion: "tearful" },
      ],
      knowledgeReveals: [], propTransfers: [], exitLocations: {}, endEmotions: { lumi: "relieved", milo: "hopeful" }, satisfiesConstraints: ["sc_lumi_fear_arc"],
    },
    {
      number: 5, act: 3, title: "The Secret", locationId: "dark_hollow", timeOfDay: "night",
      objective: "Lumi tells Milo the secret and they make a plan.",
      emotionalState: "hopeful", characterIds: ["lumi", "milo"], propIds: ["broken_compass"], eventIds: ["ev_secret_shared"], durationSec: 12,
      lines: [
        { type: "dialogue", characterId: "lumi", text: "Your compass isn't broken, Milo. Its needle points to light. To me!", emotion: "excited" },
        { type: "action", text: "Milo stares at the needle. It points straight at his glowing friend." },
        { type: "dialogue", characterId: "milo", text: "Then if you fly up high and shine, the needle will always show the way to you!", emotion: "amazed" },
        { type: "action", text: "Lumi presses the compass into Milo's paws." },
      ],
      knowledgeReveals: [{ factId: "fact_compass_points_to_light", toCharacterId: "milo", via: "Lumi tells him" }],
      propTransfers: [{ propId: "broken_compass", fromCharacterId: "lumi", toCharacterId: "milo", how: "Lumi hands it to him" }],
      exitLocations: { lumi: "old_stump", milo: "old_stump" }, endEmotions: { lumi: "determined", milo: "hopeful" }, satisfiesConstraints: [],
    },
    {
      number: 6, act: 3, title: "A Star Above the Trees", locationId: "old_stump", timeOfDay: "night",
      objective: "Lumi flies high and glows; Milo follows the needle to Pip and home; Lumi is no longer afraid.",
      emotionalState: "joyful", characterIds: ["lumi", "milo", "pip"], propIds: ["broken_compass"], eventIds: ["ev_guided_home"], durationSec: 13,
      lines: [
        { type: "action", text: "Lumi rises above the treetops, glowing like a small golden star. Below, Milo follows the needle to the mossy stump where Pip waits." },
        { type: "dialogue", characterId: "pip", text: "Milo! You found me!", emotion: "relieved" },
        { type: "dialogue", characterId: "milo", text: "Lumi found us. Look up, Pip. Follow the light!", emotion: "joyful" },
        { type: "narration", text: "That night Lumi did not hide. She glowed softly on the tallest blade of grass, and she was not afraid. The dark was only a place where her light could shine." },
      ],
      knowledgeReveals: [], propTransfers: [], exitLocations: { lumi: "willow_meadow", milo: "willow_meadow", pip: "willow_meadow" },
      endEmotions: { lumi: "calm and proud", milo: "happy", pip: "happy" }, satisfiesConstraints: ["sc_guided_home", "sc_lumi_fear_arc", "sc_theme_light_in_dark"],
    },
  ],
};

export const SHOT_PLANS: Record<string, ScenePlanOutput> = {
  scene_1: {
    shots: [
      { index: 1, durationSec: 6, framing: "wide establishing", cameraMovement: "slow push-in", characterIds: ["lumi", "milo", "pip"], propIds: [], lighting: "golden dusk, long purple shadows", action: "Milo and Pip wave from the meadow path while Lumi hovers by a bluebell", lineIndexes: [0, 1], visualPromptDraft: "A twilight meadow of tall grass and bluebells. A young rabbit and a small hedgehog wave from a path; a tiny firefly hovers nervously beside a bluebell.", positionNotes: [{ characterId: "lumi", note: "foreground right, near bluebell" }, { characterId: "milo", note: "mid-ground left on the path" }, { characterId: "pip", note: "beside Milo" }] },
      { index: 2, durationSec: 6, framing: "close-up", cameraMovement: "static", characterIds: ["lumi", "milo"], propIds: ["broken_compass"], lighting: "last violet light, Lumi's faint glow", action: "Lumi dims and slips into the bluebell; behind her the compass falls from Milo's satchel into the grass", lineIndexes: [2, 3], visualPromptDraft: "Close on a tiny firefly dimming her light as she slips into a bluebell; in soft focus behind her a rabbit hops away and a small brass compass tumbles into the grass.", positionNotes: [{ characterId: "lumi", note: "center, entering the bluebell" }, { characterId: "milo", note: "background, hopping away" }] },
    ],
  },
  scene_2: {
    shots: [
      { index: 1, durationSec: 6, framing: "medium two-shot", cameraMovement: "handheld drift", characterIds: ["milo", "pip"], propIds: [], lighting: "deep blue night, faint moonlight", action: "Pip limps beside Milo among crowded trunks", lineIndexes: [0, 1], visualPromptDraft: "Two small animals, a rabbit and a hedgehog, in a dark forest of twisted trunks. The hedgehog limps, holding a paw. Deep blue shadows.", positionNotes: [{ characterId: "milo", note: "left, supporting Pip" }, { characterId: "pip", note: "right, limping" }] },
      { index: 2, durationSec: 6, framing: "wide", cameraMovement: "static", characterIds: ["milo", "pip"], propIds: [], lighting: "moonlight on moss", action: "Pip settles on the old stump as Milo hops into the dark", lineIndexes: [2, 3], visualPromptDraft: "A hedgehog curls on a mossy stump in a tiny clearing while a rabbit hops away into the black between the trees.", positionNotes: [{ characterId: "pip", note: "on stump, center" }, { characterId: "milo", note: "small, leaving frame right" }] },
    ],
  },
  scene_3: {
    shots: [
      { index: 1, durationSec: 5, framing: "wide", cameraMovement: "slow pan", characterIds: ["lumi"], propIds: ["broken_compass"], lighting: "night, Lumi's glow the only warm light", action: "Lumi flies over the grass and spots the glint of the compass", lineIndexes: [0], visualPromptDraft: "A lone firefly with a warm yellow glow flies over dark grass at the edge of a forest; a brass compass glints below her.", positionNotes: [{ characterId: "lumi", note: "upper center, descending" }] },
      { index: 2, durationSec: 9, framing: "extreme close-up", cameraMovement: "static, needle animates", characterIds: ["lumi"], propIds: ["broken_compass"], lighting: "warm glow on brass, cracked glass reflecting", action: "The needle stops wobbling and follows Lumi as she darts left and right; she gasps and gathers the compass", lineIndexes: [1, 2, 3], visualPromptDraft: "Extreme close-up of a brass compass with cracked glass; its needle points up at a tiny glowing firefly hovering above, her light reflected in the glass.", positionNotes: [{ characterId: "lumi", note: "above the compass, reflected in glass" }] },
    ],
  },
  scene_4: {
    shots: [
      { index: 1, durationSec: 5, framing: "wide", cameraMovement: "tracking", characterIds: ["lumi"], propIds: ["broken_compass"], lighting: "a single warm light moving through blue darkness", action: "Lumi's light weaves between black trunks", lineIndexes: [0, 1], visualPromptDraft: "A small warm point of light moves between huge dark tree trunks; a tiny firefly with a scarf, holding a compass, calling out.", positionNotes: [{ characterId: "lumi", note: "center, small in frame" }] },
      { index: 2, durationSec: 7, framing: "medium two-shot", cameraMovement: "slow push-in", characterIds: ["lumi", "milo"], propIds: ["broken_compass"], lighting: "Lumi's glow lights Milo's face", action: "Milo's face lights up as Lumi arrives", lineIndexes: [2, 3], visualPromptDraft: "A young rabbit's face lit warmly from the side by a glowing firefly hovering close; relief and joy; dark forest behind.", positionNotes: [{ characterId: "lumi", note: "right, hovering at Milo's eye level" }, { characterId: "milo", note: "left, facing her" }] },
    ],
  },
  scene_5: {
    shots: [
      { index: 1, durationSec: 6, framing: "close-up", cameraMovement: "static", characterIds: ["lumi", "milo"], propIds: ["broken_compass"], lighting: "warm glow on the compass face", action: "Lumi shows Milo the needle pointing at her", lineIndexes: [0, 1], visualPromptDraft: "Close on a brass compass held in rabbit paws, its needle pointing at a glowing firefly; the rabbit's eyes wide.", positionNotes: [{ characterId: "lumi", note: "upper right, hovering" }, { characterId: "milo", note: "holding compass, lower left" }] },
      { index: 2, durationSec: 6, framing: "medium two-shot", cameraMovement: "slow push-in", characterIds: ["lumi", "milo"], propIds: ["broken_compass"], lighting: "warm and hopeful", action: "Milo realises the plan; Lumi hands him the compass", lineIndexes: [2, 3], visualPromptDraft: "A firefly presses a small brass compass into a young rabbit's paws in a dark forest; both smiling with hope.", positionNotes: [{ characterId: "lumi", note: "center" }, { characterId: "milo", note: "center, receiving compass" }] },
    ],
  },
  scene_6: {
    shots: [
      { index: 1, durationSec: 5, framing: "wide low angle", cameraMovement: "crane up", characterIds: ["lumi"], propIds: [], lighting: "a golden star above black treetops", action: "Lumi rises above the treetops and glows", lineIndexes: [0], visualPromptDraft: "Low angle: a tiny firefly rises above dark treetops into the night sky, glowing like a golden star.", positionNotes: [{ characterId: "lumi", note: "top center, small and bright" }] },
      { index: 2, durationSec: 4, framing: "medium", cameraMovement: "static", characterIds: ["milo", "pip"], propIds: ["broken_compass"], lighting: "faint golden light from above", action: "Milo reaches the stump; Pip leaps up; they look at the compass needle pointing skyward", lineIndexes: [1, 2], visualPromptDraft: "A rabbit with a compass reaches a mossy stump where a hedgehog jumps up happily; both look up toward a golden light.", positionNotes: [{ characterId: "milo", note: "left, holding compass" }, { characterId: "pip", note: "right, on stump" }] },
      { index: 3, durationSec: 4, framing: "wide", cameraMovement: "slow pull-back", characterIds: ["lumi", "milo", "pip"], propIds: [], lighting: "Lumi's glow like a lantern over the meadow", action: "Back at the meadow, Lumi glows on the tallest blade of grass while her friends rest below", lineIndexes: [3], visualPromptDraft: "A twilight meadow at night; a tiny firefly glows on the tallest blade of grass like a lantern while a rabbit and a hedgehog rest in the grass below.", positionNotes: [{ characterId: "lumi", note: "top center on grass blade" }, { characterId: "milo", note: "bottom left" }, { characterId: "pip", note: "bottom right" }] },
    ],
  },
};
