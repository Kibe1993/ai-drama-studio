import type { StoryRecord } from "@/lib/validation/story";

function Beat({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <dt className="text-sm text-[#a39b8f]">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap">{text}</dd>
    </div>
  );
}

export function StoryReview({ story }: { story: StoryRecord }) {
  const { act1, act2, act3 } = story.structure;
  return (
    <article className="mt-6 space-y-6 text-[#cfc6b8]">
      <header>
        <h3 className="font-display text-3xl text-[#f3efe6]">{story.title}</h3>
        <p className="mt-3 whitespace-pre-wrap">{story.synopsis}</p>
      </header>
      <section>
        <h4 className="text-sm tracking-[0.14em] text-[#c4a574] uppercase">Act 1 — Setup</h4>
        <dl className="mt-3 space-y-3">
          <Beat label="Introduction" text={act1.introduction} />
          <Beat label="Main characters" text={act1.mainCharacters} />
          <Beat label="Setting" text={act1.setting} />
          <Beat label="Initial situation" text={act1.initialSituation} />
          <Beat label="Inciting incident" text={act1.incitingIncident} />
        </dl>
      </section>
      <section>
        <h4 className="text-sm tracking-[0.14em] text-[#c4a574] uppercase">Act 2 — Conflict</h4>
        <dl className="mt-3 space-y-3">
          <Beat label="Rising tension" text={act2.risingTension} />
          <Beat label="Obstacles" text={act2.obstacles} />
          <Beat label="Character decisions" text={act2.characterDecisions} />
          <Beat label="Turning point" text={act2.turningPoint} />
        </dl>
      </section>
      <section>
        <h4 className="text-sm tracking-[0.14em] text-[#c4a574] uppercase">Act 3 — Resolution</h4>
        <dl className="mt-3 space-y-3">
          <Beat label="Climax" text={act3.climax} />
          <Beat label="Resolution" text={act3.resolution} />
          <Beat label="Final outcome" text={act3.finalOutcome} />
        </dl>
      </section>
      <section>
        <h4 className="text-sm tracking-[0.14em] text-[#c4a574] uppercase">Screenplay</h4>
        <ol className="mt-3 space-y-5">
          {story.screenplay.map((scene) => (
            <li key={scene.sceneNumber} className="border-t border-[#2e2a25] pt-4">
              <p className="text-[#f3efe6]">
                Scene {scene.sceneNumber}. {scene.heading}
              </p>
              <p className="mt-1 text-sm text-[#a39b8f]">
                {scene.location} · {scene.timeOfDay} · {scene.charactersPresent.join(", ")}
              </p>
              <p className="mt-3 whitespace-pre-wrap">{scene.visualDescription}</p>
              <p className="mt-3 whitespace-pre-wrap">{scene.action}</p>
              {scene.dialogue.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {scene.dialogue.map((line, index) => (
                    <li key={`${scene.sceneNumber}-${index}`}>
                      <span className="text-[#f3efe6]">{line.characterName}. </span>
                      {line.line}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
