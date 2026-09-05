import type { CreateProjectInput } from "../model/index.js";

/** Original story written for this project (no third-party rights involved). */
export const LUMI_STORY = `Lumi and the Broken Compass

At the edge of Willow Meadow lived a small firefly named Lumi. She had a warm yellow glow and wore a tiny blue scarf her grandmother had knitted from spider silk. Lumi loved the meadow in daylight, when the grass shone and her friends played. But every evening, when the sky turned purple and the shadows grew long, Lumi dimmed her light and hid inside a bluebell. Lumi was afraid of the dark.

Her best friends were Milo, a young rabbit with long ears and a green satchel he carried everywhere, and Pip, a small hedgehog who collected shiny pebbles. In Milo's satchel he kept his grandfather's old brass compass. Its glass was cracked and its needle spun and wobbled instead of pointing north, so everyone called it the broken compass. Milo kept it anyway, because it had been his grandfather's.

One evening, Milo and Pip set out for the blackberry bushes beyond the meadow. "Come with us, Lumi!" called Milo. But the sun was setting, and Lumi shook her head. "It's getting dark," she whispered, and she hid her glow. As Milo hopped after Pip, the broken compass slipped from his satchel and fell into the grass at the meadow's edge. Nobody noticed.

Night came. In the Dark Hollow, the trees grew so close together that Milo and Pip could not see the path. They were lost. Pip had hurt his paw on a root, so Milo helped him to an old stump. "Wait here," said Milo. "I'll find the way." But every direction looked the same.

Back at the meadow, Lumi waited and waited. Her friends did not come home. Then, in the grass at the meadow's edge, she saw something glint: Milo's compass. She flew close, and something surprising happened. The wobbling needle stopped wobbling. It turned and pointed straight at her. Lumi flew to the left; the needle followed. She flew to the right; the needle followed again. "It doesn't point north at all," Lumi gasped. "It points to the brightest light!" And the brightest light in the meadow, on this dark night, was Lumi herself. That was the compass's secret, and for now only Lumi knew it.

Lumi looked at the Dark Hollow. Her wings trembled. But her friends were in there. She picked up the compass in her tiny arms, took a deep breath, and let her glow shine as bright as she could. Then she flew into the dark.

Deep in the hollow she found Milo, calling Pip's name. He was so happy to see her glow that he nearly cried. Lumi told him the secret: "Your compass isn't broken, Milo. Its needle points to light. To me!" Milo stared at the needle, which pointed straight at his glowing friend. "Then if you fly up high and shine," he said slowly, "the needle will always show the way to you."

So that is what they did. Lumi gave Milo the compass and flew up above the treetops, glowing like a small golden star. Milo followed the needle to the old stump, found Pip, and together they followed it all the way back to Willow Meadow, where Lumi's light hung in the sky like a lantern.

That night, Lumi did not hide in the bluebell. She sat on the tallest blade of grass, glowing softly, and she was not afraid. The dark, she had learned, was only a place where her light could shine.`;

export const LUMI_DEMO_INPUT: CreateProjectInput = {
  title: "Lumi and the Broken Compass",
  mode: "kids",
  source: {
    kind: "original",
    title: "Lumi and the Broken Compass",
    author: "CineMemory team (original work)",
    text: LUMI_STORY,
    rightsNote: "Original story written for the CineMemory demo. No third-party characters or text.",
  },
  brief: {
    genre: "gentle adventure",
    audience: "children",
    ageRange: "6-9",
    targetDurationSec: 75,
    language: "English",
    visualStyle: "soft painterly 2D children's animation, warm twilight palette, rounded friendly character designs",
    tone: "warm, reassuring, a little bit magical",
    format: "animated short",
    adaptationInstructions: "Keep Lumi's fear of the dark and her discovery of the compass secret as the emotional core. Milo must only learn the secret when Lumi tells him.",
    requiredFacts: ["Fireflies make their own light; this is called bioluminescence."],
  },
};
