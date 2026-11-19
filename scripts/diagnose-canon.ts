import { loadEnvConfig } from "@next/env";
import { connectDB } from "@/lib/db/connect";
import { storyBibleRepository } from "@/lib/repositories/storyBibleRepository";
import { seasonPlanRepository } from "@/lib/repositories/seasonPlanRepository";
import { continuityLedgerRepository } from "@/lib/repositories/continuityLedgerRepository";
import { storyRepository } from "@/lib/repositories/storyRepository";
import { episodeRepository } from "@/lib/repositories/episodeRepository";
import { narrativeCanonRepository } from "@/lib/repositories/narrativeCanonRepository";
import { canonFromApprovedSources } from "@/lib/domain/narrativeControl/projectCanon";
import { extractEpisodeCanon } from "@/lib/domain/episodeCanon";
import { deriveEpisodePlan } from "@/lib/domain/episodePlan";
import type { StoryBibleContent } from "@/lib/validation/storyBible";

async function main() {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  const args = process.argv.slice(2);
  const projectId = args.find((a) => a.startsWith("--project="))?.split("=")[1];
  const episodeNumber = Number(args.find((a) => a.startsWith("--episode="))?.split("=")[1]);
  const clerkUserId = args.find((a) => a.startsWith("--user="))?.split("=")[1] ?? "";

  if (!projectId || !episodeNumber) {
    console.error("Usage: npx tsx scripts/diagnose-canon.ts --project=<projectId> --episode=<N> [--user=<clerkUserId>]");
    process.exitCode = 1;
    return;
  }

  await connectDB();

  console.log("=".repeat(80));
  console.log(`CANON DIAGNOSTIC — Project ${projectId}, Episode ${episodeNumber}`);
  console.log("=".repeat(80));

  // 1. Story Bible
  console.log("\n--- 1. STORY BIBLE ---");
  const bibleSnapshot = await storyBibleRepository.findApproved(clerkUserId, projectId);
  const bibleContent: StoryBibleContent | null = bibleSnapshot?.content ?? null;
  if (bibleSnapshot) {
    console.log(`  version: ${bibleSnapshot.version}`);
    if (bibleContent) {
      console.log(`  title: ${bibleContent.identity.title}`);
      console.log(`  characters: ${bibleContent.characters.characters.map((c) => c.name).join(", ")}`);
      console.log(`  confirmedFacts: ${JSON.stringify(bibleContent.canon.confirmedFacts)}`);
      console.log(`  hiddenInformation: ${JSON.stringify(bibleContent.canon.hiddenInformation)}`);
    } else {
      console.log("  (no rich content — legacy bible)");
    }
  } else {
    console.log("  (no approved bible found)");
  }

  // 2. Season Plan
  console.log("\n--- 2. SEASON PLAN ---");
  const plan = await seasonPlanRepository.findApproved(clerkUserId, projectId);
  if (plan) {
    console.log(`  version: ${plan.version}`);
    console.log(`  basedOnBibleVersion: ${plan.basedOnBibleVersion}`);
    console.log(`  seasonObjective: ${plan.seasonObjective}`);
    const epItem = plan.episodeProgression.find((e) => e.episodeNumber === episodeNumber);
    if (epItem) {
      console.log(`  episode ${episodeNumber} plan item:`);
      console.log(`    workingTitle: ${epItem.workingTitle}`);
      console.log(`    majorStoryBeats: ${JSON.stringify(epItem.majorStoryBeats)}`);
      console.log(`    informationRevealed: ${JSON.stringify(epItem.informationRevealed)}`);
      console.log(`    consequences: ${JSON.stringify(epItem.consequences)}`);
    } else {
      console.log(`  (no plan item for episode ${episodeNumber})`);
    }
  } else {
    console.log("  (no approved season plan found)");
  }

  // 3. Continuity Ledger
  console.log("\n--- 3. CONTINUITY LEDGER ---");
  const ledger = await continuityLedgerRepository.findLatest(clerkUserId, projectId);
  if (ledger) {
    console.log(`  version: ${ledger.version}`);
    console.log(`  asOfEpisode: ${ledger.asOfEpisode}`);
    console.log(`  basedOnPlanVersion: ${ledger.basedOnPlanVersion}`);
    console.log(`  events: ${ledger.events.length}`);
    for (const event of ledger.events.slice(-5)) {
      console.log(`    [ep${event.episodeNumber}] ${event.event} → ${event.consequence}`);
    }
    console.log(`  characterStates: ${ledger.characterStates.length}`);
    for (const state of ledger.characterStates) {
      console.log(`    ${state.name}: location=${state.currentLocation}, physical=${state.physicalState || "n/a"}, knowledge=${state.knowledge.length}`);
    }
    console.log(`  revealedSecrets: ${JSON.stringify(ledger.revealedSecrets)}`);
    console.log(`  unresolvedThreads: ${ledger.unresolvedThreads.length}`);
    for (const thread of ledger.unresolvedThreads) {
      console.log(`    [${thread.status}] ${thread.thread}`);
    }
    console.log(`  consequences: ${JSON.stringify(ledger.consequences)}`);
  } else {
    console.log("  (no ledger found)");
  }

  // 4. Narrative Canon (CanonState)
  console.log("\n--- 4. NARRATIVE CANON (CanonState) ---");
  const canon = await narrativeCanonRepository.latest(clerkUserId, projectId);
  if (canon) {
    console.log(`  version: ${canon.version}`);
    console.log(`  basedOnBibleVersion: ${canon.basedOnBibleVersion}`);
    console.log(`  basedOnPlanVersion: ${canon.basedOnPlanVersion}`);
    console.log(`  entities: ${canon.entities.length}`);
    for (const entity of canon.entities) {
      console.log(`    [${entity.kind}] ${entity.name} (aliases: ${entity.aliases.join(", ") || "none"}) lifecycle=${entity.lifecycle}`);
    }
    console.log(`  facts: ${canon.facts.length}`);
    for (const fact of canon.facts.slice(-10)) {
      console.log(`    [${fact.classification}] ${fact.statement.slice(0, 80)}`);
    }
    console.log(`  threads: ${canon.threads.length}`);
    console.log(`  rules: ${canon.rules.length}`);
  } else {
    console.log("  (no narrative canon found)");
  }

  // 5. Episodes
  console.log("\n--- 5. EPISODES ---");
  const episodes = (await episodeRepository.listOwned(clerkUserId, projectId)) ?? [];
  for (const ep of episodes) {
    console.log(`  ep${ep.episodeNumber}: status=${ep.status}, currentStoryId=${ep.currentStoryId ?? "none"}`);
  }

  // 6. Approved Story (screenplay)
  console.log(`\n--- 6. APPROVED STORY FOR EPISODE ${episodeNumber} ---`);
  const episode = episodes.find((e) => e.episodeNumber === episodeNumber);
  if (episode?.currentStoryId) {
    const story = await storyRepository.findOwned(clerkUserId, episode.currentStoryId);
    if (story) {
      console.log(`  storyId: ${story.id}`);
      console.log(`  status: ${story.status}`);
      console.log(`  title: ${story.title}`);
      console.log(`  provider: ${story.provider}, model: ${story.model}`);
      console.log(`  sourceCanonVersion: ${story.sourceCanonVersion ?? "none"}`);
      console.log(`  canonStale: ${story.canonStale ?? false}`);
      console.log(`  synopsis: ${story.synopsis.slice(0, 200)}`);
      console.log(`  screenplay scenes: ${story.screenplay.length}`);
      for (const scene of story.screenplay) {
        const dialogueText = scene.dialogue.map((d) => `${d.characterName}: ${d.line}`).join(" ");
        console.log(`    scene ${scene.sceneNumber} [${scene.location}]: ${scene.action.slice(0, 80)} | ${dialogueText.slice(0, 80)}`);
      }
      console.log(`  canonSummary: ${story.canonSummary ? "present" : "null"}`);
      if (story.canonSummary) {
        console.log(`    events: ${story.canonSummary.events.length}`);
        console.log(`    characterStates: ${story.canonSummary.characterStates.length}`);
        console.log(`    revealedSecrets: ${JSON.stringify(story.canonSummary.revealedSecrets)}`);
      }
      console.log(`  validationFindings: ${story.validationFindings ? `${story.validationFindings.findings.length} findings, passed=${story.validationFindings.passed}` : "null"}`);
      console.log(`  promptFingerprint: ${story.promptFingerprint ?? "none"}`);

      // 7. Plan-derived canon summary vs screenplay
      console.log("\n--- 7. PLAN-DERIVED CANON SUMMARY ---");
      if (plan && bibleContent) {
        const episodePlan = story.plan ?? deriveEpisodePlan({
          plan,
          ledger: ledger ?? null,
          previousEpisode: null,
          episodeNumber,
        });
        const summary = extractEpisodeCanon({
          episodeNumber,
          story,
          plan,
          episodePlan,
          ledger: ledger ?? null,
        });
        console.log(`  extracted events: ${summary.events.length}`);
        for (const event of summary.events) {
          console.log(`    ${event.event} → ${event.consequence}`);
        }
        console.log(`  extracted characterStates: ${summary.characterStates.length}`);
        for (const state of summary.characterStates) {
          console.log(`    ${state.name}: location=${state.currentLocation}, physical=${state.physicalState || "n/a"}`);
        }
        console.log(`  extracted revealedSecrets: ${JSON.stringify(summary.revealedSecrets)}`);
        console.log(`  extracted unresolvedThreads: ${summary.unresolvedThreads.length}`);
      }

      // 8. Derived canon from bible + ledger
      console.log("\n--- 8. DERIVED CANON FROM BIBLE + LEDGER ---");
      if (bibleContent) {
        const derived = canonFromApprovedSources({
          projectId,
          bible: bibleContent,
          ledger: ledger ?? null,
          bibleVersion: bibleSnapshot?.version ?? 0,
          planVersion: plan?.version,
        });
        console.log(`  derived entities: ${derived.entities.length}`);
        for (const entity of derived.entities) {
          console.log(`    [${entity.kind}] ${entity.name} lifecycle=${entity.lifecycle}`);
        }
        console.log(`  derived facts: ${derived.facts.length}`);
        console.log(`  derived threads: ${derived.threads.length}`);
      }
    } else {
      console.log("  (story not found)");
    }
  } else {
    console.log("  (no approved story for this episode)");
  }

  // 9. Differences
  console.log("\n--- 9. DIFFERENCES ---");
  if (ledger && canon) {
    const ledgerCharNames = new Set(ledger.characterStates.map((s) => s.name.toLowerCase()));
    const canonCharNames = new Set(canon.entities.filter((e) => e.kind === "character").map((e) => e.name.toLowerCase()));
    const inLedgerNotCanon = [...ledgerCharNames].filter((n) => !canonCharNames.has(n));
    const inCanonNotLedger = [...canonCharNames].filter((n) => !ledgerCharNames.has(n));
    if (inLedgerNotCanon.length > 0) console.log(`  Characters in ledger but not in canon: ${inLedgerNotCanon.join(", ")}`);
    if (inCanonNotLedger.length > 0) console.log(`  Characters in canon but not in ledger: ${inCanonNotLedger.join(", ")}`);
    if (inLedgerNotCanon.length === 0 && inCanonNotLedger.length === 0) console.log("  Character names are consistent between ledger and canon.");
  }
  if (ledger && plan) {
    if (ledger.basedOnPlanVersion !== plan.version) {
      console.log(`  WARNING: ledger basedOnPlanVersion=${ledger.basedOnPlanVersion} but plan version=${plan.version}`);
    }
  }

  // 10. Historical prompt
  console.log("\n--- 10. HISTORICAL PROMPT ---");
  console.log("  Historical LLM prompts are not persisted in the current application.");
  console.log("  The promptFingerprint field stores a SHA-256 hash of the prompt digest,");
  console.log("  but the full prompt text is not recoverable from stored data.");

  console.log("\n" + "=".repeat(80));
  console.log("DIAGNOSTIC COMPLETE");
  console.log("=".repeat(80));
}

main().catch((error: unknown) => {
  console.error(`Diagnostic failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});