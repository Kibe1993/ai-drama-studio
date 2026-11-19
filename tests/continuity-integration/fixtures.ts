import type { ScreenplayScene } from "@/lib/validation/story";
import type { SeasonPlan, EpisodePlanItem } from "@/lib/validation/seasonPlan";
import type { StoryBibleContent } from "@/lib/validation/storyBible";
import type { ContinuityLedger, CharacterState } from "@/lib/validation/continuityLedger";
import type { EpisodeCanonSummary } from "@/lib/validation/casna";

export function makeScene(overrides: Partial<ScreenplayScene> & { sceneNumber: number }): ScreenplayScene {
  return {
    heading: `INT. ROOM - DAY`,
    location: "Room",
    timeOfDay: "DAY",
    charactersPresent: ["Alice"],
    visualDescription: "A quiet room with soft light.",
    action: "Alice enters and looks around.",
    dialogue: [{ characterName: "Alice", line: "What is going on here?" }],
    ...overrides,
  };
}

export function makeEpisodeScreenplay(episodeNumber: number, characters: string[], location: string): ScreenplayScene[] {
  return [
    makeScene({
      sceneNumber: 1,
      location,
      charactersPresent: characters,
      visualDescription: `Episode ${episodeNumber} opens at ${location}.`,
      action: `${characters.join(" and ")} arrive at ${location}.`,
      dialogue: characters.map((c) => ({ characterName: c, line: `This is episode ${episodeNumber}.` })),
    }),
    makeScene({
      sceneNumber: 2,
      location,
      charactersPresent: characters,
      visualDescription: `The situation develops at ${location}.`,
      action: `${characters[0]} confronts the challenge of episode ${episodeNumber}.`,
      dialogue: [{ characterName: characters[0]!, line: `We must deal with this now.` }],
    }),
    makeScene({
      sceneNumber: 3,
      location,
      charactersPresent: characters,
      visualDescription: `Episode ${episodeNumber} reaches its turning point.`,
      action: `${characters[0]} makes a decisive choice.`,
      dialogue: [{ characterName: characters[0]!, line: `This changes everything.` }],
    }),
  ];
}

export function makeEpisodePlanItem(overrides: Partial<EpisodePlanItem> & { episodeNumber: number }): EpisodePlanItem {
  return {
    workingTitle: `Episode ${overrides.episodeNumber}`,
    narrativePurpose: `Advance the central conflict in episode ${overrides.episodeNumber}.`,
    startingSituation: `The story continues from the previous episode.`,
    mainObjective: `The protagonist pursues their goal.`,
    centralConflict: `A new obstacle emerges.`,
    majorStoryBeats: ["The protagonist learns something new.", "A confrontation occurs.", "A decision is made."],
    informationRevealed: [],
    characterDevelopment: `The protagonist grows through the events of episode ${overrides.episodeNumber}.`,
    importantEvents: ["A key event takes place."],
    consequences: ["The aftermath carries forward."],
    storyContribution: `This episode advances the season arc.`,
    endingOrCliffhanger: `Episode ${overrides.episodeNumber} ends on a turning point.`,
    unresolvedThreads: [],
    continuityRequirements: `The episode must respect the established canon.`,
    characterArcChanges: [],
    relationshipChanges: [],
    objectChanges: [],
    locationChanges: [],
    ...overrides,
  };
}

export function makeSeasonPlan(episodeCount: number, overrides: Partial<SeasonPlan> = {}): SeasonPlan {
  return {
    seasonObjective: "Resolve the central mystery across one season.",
    centralConflictOrMystery: "A secret threatens to unravel everything.",
    mainCharacterObjectives: "The protagonist seeks the truth.",
    overallCharacterDevelopment: "The protagonist grows from naive to wise.",
    majorStoryDevelopments: ["The secret is discovered.", "The truth is confronted.", "The aftermath is dealt with."],
    beginningDirection: "Establish the world and the protagonist's starting point.",
    middleDirection: "Escalate the conflict and deepen the mystery.",
    endingDirection: "Resolve the central conflict and pay off the setup.",
    episodeProgression: Array.from({ length: episodeCount }, (_, i) =>
      makeEpisodePlanItem({
        episodeNumber: i + 1,
        workingTitle: `Episode ${i + 1}`,
        endingOrCliffhanger:
          i + 1 < episodeCount
            ? `Episode ${i + 1} ends with a cliffhanger.`
            : `Episode ${i + 1} ends with the resolution.`,
      }),
    ),
    importantRevelations: ["The secret is revealed."],
    relationshipChanges: ["The protagonist's key relationship deepens."],
    consequencesCarriedBetween: ["Every episode's consequences carry forward."],
    setupAndPayoff: ["A setup in episode 1 pays off in the finale."],
    unresolvedQuestions: ["What is the truth behind the mystery?"],
    intendedSeasonConclusion: "The protagonist confronts and resolves the mystery.",
    ...overrides,
  };
}

export function makeStoryBible(overrides: Partial<StoryBibleContent> = {}): StoryBibleContent {
  return {
    identity: {
      title: "The Hidden Truth",
      genres: ["thriller"],
      subgenres: ["mystery"],
      centralPremise: "A journalist discovers a secret that changes everything.",
      narrativeConcept: "The truth is hidden in plain sight.",
      toneAndAtmosphere: "Tense and atmospheric.",
      targetAudience: "Adults who enjoy mysteries.",
      centralConflict: "The protagonist vs. the truth.",
    },
    world: {
      description: "A small town with a big secret.",
      geographyAndLocations: [
        { name: "Town Square", description: "The center of town life.", storyFunction: "Meeting place." },
        { name: "The Old House", description: "Where the secret is hidden.", storyFunction: "Key location." },
      ],
      socialStructuresAndCultures: ["Small-town dynamics."],
      historyAndPastEvents: ["An event twenty years ago started everything."],
      rules: ["The truth always comes out eventually."],
      definingSystems: [],
    },
    characters: {
      characters: [
        {
          name: "Alice",
          storyRole: "protagonist",
          roleDescription: "A determined journalist.",
          physicalDescription: "Sharp eyes, practical clothes.",
          personality: "Curious and brave.",
          background: "Grew up in the town.",
          motivations: ["Find the truth."],
          fearsAndWeaknesses: ["Fear of being wrong."],
          abilitiesAndLimitations: ["Excellent research skills."],
          relationships: [{ characterName: "Bob", relationship: "old friend", tensionOrChange: "Trust strains as secrets emerge." }],
          secrets: ["Alice once stole a story."],
          developmentPotential: "Alice learns to face consequences.",
        },
        {
          name: "Bob",
          storyRole: "supporting",
          roleDescription: "A quiet librarian.",
          physicalDescription: "Tall, reserved.",
          personality: "Cautious and loyal.",
          background: "Has lived in town all his life.",
          motivations: ["Protect the town's peace."],
          fearsAndWeaknesses: ["Fear of change."],
          abilitiesAndLimitations: ["Knows everyone."],
          relationships: [{ characterName: "Alice", relationship: "old friend", tensionOrChange: "Wants to help but fears the truth." }],
          secrets: ["Bob knows the secret."],
          developmentPotential: "Bob must choose between silence and truth.",
        },
      ],
      relationshipDynamics: ["Alice and Bob have a deep bond tested by the mystery."],
    },
    narrative: {
      mainStoryline: "Alice investigates the town's secret with Bob's reluctant help.",
      majorConflicts: ["Truth vs. silence.", "Friendship vs. duty."],
      longTermDirection: "The truth emerges and transforms everyone.",
      subplots: ["Alice's career stakes."],
      unresolvedMysteries: ["What happened twenty years ago?"],
      potentialFutureRevelations: ["Bob's role in the original event."],
      majorNarrativeQuestions: ["Will Alice find the truth?"],
      serializedEndingGuidance: "End on a revelation that reframes the season.",
    },
    guidelines: {
      mainThemes: ["Truth.", "Courage."],
      secondaryThemes: ["Friendship.", "Consequences."],
      storytellingStyle: "Slow-burn mystery with emotional stakes.",
      boundaries: ["No gratuitous violence."],
      mustRemainConsistent: ["Alice is a journalist.", "Bob is a librarian."],
    },
    canon: {
      confirmedFacts: ["Alice is a journalist.", "Bob is a librarian."],
      proposedDetails: ["The secret involves a document."],
      unresolvedQuestions: ["What is in the document?"],
      hiddenInformation: ["Bob knows what happened twenty years ago."],
      characterKnowledge: [
        { characterName: "Alice", knows: ["Bob is hiding something."], believes: ["The document exists."] },
        { characterName: "Bob", knows: ["What happened twenty years ago."], believes: ["The truth should stay hidden."] },
      ],
      audienceKnowledge: ["Alice is investigating the town's past."],
    },
    ...overrides,
  };
}

export function makeCharacterState(overrides: Partial<CharacterState> & { name: string }): CharacterState {
  return {
    currentLocation: "Town Square",
    currentObjective: "Find the truth.",
    knowledge: [],
    beliefs: [],
    motivations: [],
    emotionalState: "Determined.",
    physicalState: "",
    relationships: [],
    ...overrides,
  };
}

export function makeLedger(overrides: Partial<ContinuityLedger> = {}): ContinuityLedger {
  return {
    events: [],
    characterStates: [],
    locationStates: [],
    objectStates: [],
    revealedSecrets: [],
    unresolvedThreads: [],
    consequences: [],
    timelineNotes: "",
    ...overrides,
  };
}

export function makeEpisodeCanonSummary(
  overrides: Partial<EpisodeCanonSummary> & { episodeNumber: number },
): EpisodeCanonSummary {
  return {
    title: `Episode ${overrides.episodeNumber}`,
    summary: `Episode ${overrides.episodeNumber} summary.`,
    events: [],
    characterStates: [],
    locationStates: [],
    objectStates: [],
    revealedSecrets: [],
    unresolvedThreads: [],
    consequences: [],
    ...overrides,
  };
}

export function makeSeasonPlanRecord(plan: SeasonPlan, version: number = 1) {
  return {
    ...plan,
    version,
    id: "plan-id",
    clerkUserId: "user-id",
    projectId: "project-id",
    status: "approved" as const,
    basedOnBibleVersion: 1,
    basedOnBibleFingerprint: "fingerprint",
    revisionHistory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}