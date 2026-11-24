"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/hooks/api";
import { useApproveStoryBible, useSaveStoryBible, useStoryBible } from "@/hooks/useStoryBible";
import {
  storyBibleContentSchema,
  legacyStoryBibleFields,
  STORY_BIBLE_SECTIONS,
  type StoryBibleContent,
  type StoryBibleDraft,
  type StoryBibleSection,
} from "@/lib/validation/storyBible";

const SECTIONS = STORY_BIBLE_SECTIONS;
const LABELS: Record<StoryBibleSection, string> = {
  identity: "Series identity",
  world: "World and setting",
  characters: "Characters and relationships",
  narrative: "Narrative direction",
  guidelines: "Creative guidelines",
  canon: "Canon and knowledge",
};
const STORY_ROLES = ["protagonist", "antagonist", "supporting", "recurring"] as const;

function lines(value: string): string[] {
  return value.split("\n").map((l) => l.trim()).filter(Boolean);
}

type Location = { name: string; description: string; storyFunction: string };
type WorldSystem = { name: string; description: string; limitations: string[]; consequences: string[] };
type Relationship = { characterName: string; relationship: string; tensionOrChange: string };
type Character = StoryBibleContent["characters"]["characters"][number];
type CharacterKnowledge = { characterName: string; knows: string[]; believes: string[] };

function emptyContent(title = "", premise = ""): StoryBibleContent {
  return {
    identity: {
      title,
      genres: [""],
      subgenres: [],
      centralPremise: premise,
      narrativeConcept: "",
      toneAndAtmosphere: "",
      targetAudience: "",
      centralConflict: "",
    },
    world: {
      description: "",
      geographyAndLocations: [
        { name: "", description: "", storyFunction: "" },
        { name: "", description: "", storyFunction: "" },
      ],
      socialStructuresAndCultures: [],
      historyAndPastEvents: [],
      rules: [],
      definingSystems: [],
    },
    characters: {
      characters: [emptyCharacter(), emptyCharacter()],
      relationshipDynamics: [],
    },
    narrative: {
      mainStoryline: "",
      majorConflicts: [],
      longTermDirection: "",
      subplots: [],
      unresolvedMysteries: [],
      potentialFutureRevelations: [],
      majorNarrativeQuestions: [],
      serializedEndingGuidance: "",
    },
    guidelines: {
      mainThemes: [],
      secondaryThemes: [],
      storytellingStyle: "",
      boundaries: [],
      mustRemainConsistent: [],
    },
    canon: {
      confirmedFacts: [],
      proposedDetails: [],
      unresolvedQuestions: [],
      hiddenInformation: [],
      characterKnowledge: [],
      audienceKnowledge: [],
    },
  };
}

function emptyCharacter(): Character {
  return {
    name: "",
    storyRole: "supporting",
    roleDescription: "",
    physicalDescription: "",
    personality: "",
    background: "",
    motivations: [],
    fearsAndWeaknesses: [],
    abilitiesAndLimitations: [],
    relationships: [],
    secrets: [],
    developmentPotential: "",
  };
}

export function StoryBibleEditor({ projectId, readOnly = false, initialIdea = "", initialTitle = "" }: {
  projectId: string; readOnly?: boolean; initialIdea?: string; initialTitle?: string;
}) {
  const query = useStoryBible(projectId);
  const save = useSaveStoryBible(projectId);
  const approve = useApproveStoryBible(projectId);
  const [content, setContent] = useState<StoryBibleContent | undefined>(undefined);
  const [validationErrors, setValidationErrors] = useState<{ path: string; message: string }[] | null>(null);
  const bible = query.data?.bible;

  useEffect(() => {
    if (!bible) return;
    setContent(bible.content);
  }, [bible]);

  const mutationPending = save.isPending || approve.isPending;
  const savedContentJson = bible?.content ? JSON.stringify(bible.content) : undefined;
  const currentContentJson = content ? JSON.stringify(content) : undefined;
  const hasUnsavedChanges = currentContentJson !== savedContentJson;
  const unchangedSinceApproval = Boolean(bible && bible.draftRevision === bible.approvedVersion);
  const hasLegacyContent = Boolean(bible && (bible.premise.trim() || bible.worldRules.length || bible.themes.length || bible.boundaries.length || bible.canonFacts.length));
  const hasContent = Boolean(content) || hasLegacyContent;
  const error = save.error ?? approve.error;
  const displayError = error instanceof ApiError ? error.message : error ? "The Story Bible request could not be completed." : null;

  function updateContent(updated: StoryBibleContent | undefined) {
    setContent(updated);
    if (validationErrors) setValidationErrors(null);
  }

  function startStructuredDraft() {
    updateContent(emptyContent(initialTitle, initialIdea));
  }

  function handleSave() {
    if (!content) return;
    const result = storyBibleContentSchema.safeParse(content);
    if (!result.success) {
      setValidationErrors(result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
      return;
    }
    setValidationErrors(null);
    const legacy = legacyStoryBibleFields(result.data);
    const draft: StoryBibleDraft = {
      ...legacy,
      content: result.data,
      sourceIdea: bible?.sourceIdea ?? initialIdea,
      creativeDirection: bible?.creativeDirection ?? "",
      creatorDecisions: bible?.creatorDecisions ?? [],
    };
    save.mutate(draft);
  }

  function handleApprove() {
    if (!bible) return;
    approve.mutate({ expectedVersion: bible.approvedVersion, expectedDraftRevision: bible.draftRevision });
  }

  return (
    <section className="mt-10 border-y border-[#2e2a25] py-6">
      <h2 className="font-display text-3xl">Story Bible</h2>
      <p className="mt-2 max-w-3xl text-sm text-[#a39b8f]">Review and edit the Story Bible below. Nothing becomes canon until you approve it.</p>
      {query.isLoading ? <p className="mt-4 text-sm text-[#a39b8f]">Loading Story Bible</p> : null}
      {query.isError ? <p role="alert" className="mt-4 text-sm text-[#e7b2a8]">The Story Bible could not be loaded.</p> : null}

      {bible ? <div className="mt-5 grid gap-4">
        {displayError ? <p role="alert" className="text-sm text-[#e7b2a8]">{displayError}</p> : null}

        {content ? (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-2xl">Draft — revision {bible.draftRevision}</h3>
                <p className="mt-1 text-xs text-[#a39b8f]">Edit the six sections below, then save your draft. Approving locks the saved draft as canon.</p>
              </div>
              <div className="flex gap-2">
                {!readOnly ? (
                  <Button variant="quiet" disabled={mutationPending || !hasUnsavedChanges} onClick={handleSave}>
                    {save.isPending ? "Saving" : hasUnsavedChanges ? "Save draft" : "Draft saved"}
                  </Button>
                ) : null}
                <Button disabled={mutationPending || hasUnsavedChanges || unchangedSinceApproval || !hasContent} onClick={handleApprove}>
                  {approve.isPending ? "Approving" : `Approve as canon — v${bible.approvedVersion + 1}`}
                </Button>
              </div>
            </div>

            {hasUnsavedChanges ? <p className="text-xs text-[#dfc18a]">You have unsaved changes — save the draft before approving.</p> : null}
            {unchangedSinceApproval ? <p className="text-xs text-[#a39b8f]">This draft is already approved at v{bible.approvedVersion} — make a change before approving again.</p> : null}

            {validationErrors ? (
              <div className="rounded border border-[#6b3a32] p-3">
                <p className="text-sm text-[#e7b2a8]">Validation errors — fix these before saving:</p>
                <ul className="mt-2 grid list-disc gap-1 pl-5 text-xs text-[#e7b2a8]">
                  {validationErrors.map((err, i) => <li key={i}>{err.path || "(root)"}: {err.message}</li>)}
                </ul>
              </div>
            ) : null}

            {SECTIONS.map((section) => (
              <details key={section} className="rounded border border-[#39342d] p-4" open={section === "identity"}>
                <summary className="cursor-pointer font-medium">{LABELS[section]}</summary>
                <div className="mt-4">
                  {section === "identity" ? <IdentityEditor value={content.identity} onChange={(v) => updateContent({ ...content, identity: v })} disabled={readOnly} /> : null}
                  {section === "world" ? <WorldEditor value={content.world} onChange={(v) => updateContent({ ...content, world: v })} disabled={readOnly} /> : null}
                  {section === "characters" ? <CharactersEditor value={content.characters} onChange={(v) => updateContent({ ...content, characters: v })} disabled={readOnly} /> : null}
                  {section === "narrative" ? <NarrativeEditor value={content.narrative} onChange={(v) => updateContent({ ...content, narrative: v })} disabled={readOnly} /> : null}
                  {section === "guidelines" ? <GuidelinesEditor value={content.guidelines} onChange={(v) => updateContent({ ...content, guidelines: v })} disabled={readOnly} /> : null}
                  {section === "canon" ? <CanonEditor value={content.canon} onChange={(v) => updateContent({ ...content, canon: v })} disabled={readOnly} /> : null}
                </div>
              </details>
            ))}

            {hasLegacyContent ? (
              <details className="rounded border border-[#39342d] p-4">
                <summary className="cursor-pointer font-medium">Legacy fields (read-only, kept in sync)</summary>
                <div className="mt-4 grid gap-3">
                  {bible.premise ? <div><dt className="text-xs font-medium uppercase tracking-wide text-[#a39b8f]">Premise</dt><dd className="mt-1 whitespace-pre-wrap text-sm text-[#cfc6b8]">{bible.premise}</dd></div> : null}
                  {bible.worldRules.length ? <div><dt className="text-xs font-medium uppercase tracking-wide text-[#a39b8f]">World rules</dt><dd className="mt-1"><ul className="list-disc pl-5 text-sm text-[#cfc6b8]">{bible.worldRules.map((r, i) => <li key={i}>{r}</li>)}</ul></dd></div> : null}
                  {bible.themes.length ? <div><dt className="text-xs font-medium uppercase tracking-wide text-[#a39b8f]">Themes</dt><dd className="mt-1"><ul className="list-disc pl-5 text-sm text-[#cfc6b8]">{bible.themes.map((t, i) => <li key={i}>{t}</li>)}</ul></dd></div> : null}
                  {bible.boundaries.length ? <div><dt className="text-xs font-medium uppercase tracking-wide text-[#a39b8f]">Boundaries</dt><dd className="mt-1"><ul className="list-disc pl-5 text-sm text-[#cfc6b8]">{bible.boundaries.map((b, i) => <li key={i}>{b}</li>)}</ul></dd></div> : null}
                  {bible.canonFacts.length ? <div><dt className="text-xs font-medium uppercase tracking-wide text-[#a39b8f]">Canon facts</dt><dd className="mt-1"><ul className="list-disc pl-5 text-sm text-[#cfc6b8]">{bible.canonFacts.map((c, i) => <li key={i}>{c}</li>)}</ul></dd></div> : null}
                </div>
              </details>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-3">
            <p className="text-sm text-[#a39b8f]">No structured draft yet. Start one below, or import a Story Bible from an external AI assistant.</p>
            {hasLegacyContent ? (
              <details className="rounded border border-[#39342d] p-4">
                <summary className="cursor-pointer font-medium">Legacy data (read-only)</summary>
                <div className="mt-4 grid gap-3">
                  {bible.premise ? <div><dt className="text-xs font-medium uppercase tracking-wide text-[#a39b8f]">Premise</dt><dd className="mt-1 whitespace-pre-wrap text-sm text-[#cfc6b8]">{bible.premise}</dd></div> : null}
                  {bible.worldRules.length ? <div><dt className="text-xs font-medium uppercase tracking-wide text-[#a39b8f]">World rules</dt><dd className="mt-1"><ul className="list-disc pl-5 text-sm text-[#cfc6b8]">{bible.worldRules.map((r, i) => <li key={i}>{r}</li>)}</ul></dd></div> : null}
                  {bible.themes.length ? <div><dt className="text-xs font-medium uppercase tracking-wide text-[#a39b8f]">Themes</dt><dd className="mt-1"><ul className="list-disc pl-5 text-sm text-[#cfc6b8]">{bible.themes.map((t, i) => <li key={i}>{t}</li>)}</ul></dd></div> : null}
                  {bible.boundaries.length ? <div><dt className="text-xs font-medium uppercase tracking-wide text-[#a39b8f]">Boundaries</dt><dd className="mt-1"><ul className="list-disc pl-5 text-sm text-[#cfc6b8]">{bible.boundaries.map((b, i) => <li key={i}>{b}</li>)}</ul></dd></div> : null}
                  {bible.canonFacts.length ? <div><dt className="text-xs font-medium uppercase tracking-wide text-[#a39b8f]">Canon facts</dt><dd className="mt-1"><ul className="list-disc pl-5 text-sm text-[#cfc6b8]">{bible.canonFacts.map((c, i) => <li key={i}>{c}</li>)}</ul></dd></div> : null}
                </div>
              </details>
            ) : null}
            {!readOnly ? <Button variant="quiet" className="w-fit" onClick={startStructuredDraft}>Start structured draft</Button> : null}
            {hasLegacyContent ? (
              <div className="flex flex-wrap gap-3">
                <Button disabled={mutationPending || unchangedSinceApproval} onClick={handleApprove}>
                  {approve.isPending ? "Approving" : `Approve legacy as canon — v${bible.approvedVersion + 1}`}
                </Button>
              </div>
            ) : null}
          </div>
        )}

        <p className="text-xs text-[#a39b8f]">Approved version: {bible.approvedVersion || "none"} · draft revision {bible.draftRevision}. Each approval stores an immutable canon snapshot.</p>
        {bible.approvedSnapshot ? <p className="text-xs text-[#a39b8f]">Production uses approved version {bible.approvedSnapshot.version}. Current draft remains unapproved until you approve it.</p> : null}
      </div> : null}
    </section>
  );
}

function TextField({ label, value, onChange, max, disabled, placeholder }: {
  label: string; value: string; onChange: (value: string) => void; max: number; disabled?: boolean; placeholder?: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-medium text-[#a39b8f]">{label}</span>
      <input type="text" className="studio-field" value={value} maxLength={max} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function TextAreaField({ label, value, onChange, max, disabled, placeholder }: {
  label: string; value: string; onChange: (value: string) => void; max: number; disabled?: boolean; placeholder?: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-medium text-[#a39b8f]">{label}</span>
      <textarea className="studio-field min-h-20 resize-y" value={value} maxLength={max} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function StringListField({ label, value, onChange, max, itemMax, min = 0, disabled }: {
  label: string; value: string[]; onChange: (value: string[]) => void; max: number; itemMax: number; min?: number; disabled?: boolean;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-medium text-[#a39b8f]">{label} <span className="text-[#6b6358]">(one per line{min > 0 ? `, min ${min}` : ""}, max {max})</span></span>
      <textarea className="studio-field min-h-20 resize-y" value={value.join("\n")} maxLength={max * (itemMax + 1)} disabled={disabled} onChange={(e) => onChange(lines(e.target.value))} />
    </label>
  );
}

function EnumField({ label, value, onChange, options, disabled }: {
  label: string; value: string; onChange: (value: string) => void; options: readonly string[]; disabled?: boolean;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-medium text-[#a39b8f]">{label}</span>
      <select className="studio-field" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </label>
  );
}

function CardListField<T>({ label, items, onChange, min = 0, max, disabled, renderItem, createItem, itemNoun }: {
  label: string; items: T[]; onChange: (items: T[]) => void; min?: number; max: number; disabled?: boolean;
  renderItem: (item: T, update: (item: T) => void) => ReactNode; createItem: () => T; itemNoun: string;
}) {
  function updateAt(index: number, item: T) {
    const next = [...items];
    next[index] = item;
    onChange(next);
  }
  function removeAt(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }
  function add() {
    if (items.length >= max) return;
    onChange([...items, createItem()]);
  }
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[#a39b8f]">{label} ({items.length}/{max}{min > 0 ? `, min ${min}` : ""})</span>
        {!disabled && items.length < max ? <Button variant="quiet" size="sm" onClick={add}>Add {itemNoun}</Button> : null}
      </div>
      {items.length === 0 ? <p className="text-xs text-[#6b6358]">None specified</p> : (
        <div className="grid gap-3">
          {items.map((item, index) => (
            <div key={index} className="grid gap-2 rounded border border-[#39342d] p-3">
              {renderItem(item, (updated) => updateAt(index, updated))}
              {!disabled && items.length > min ? <Button variant="danger" size="sm" className="w-fit" onClick={() => removeAt(index)}>Remove</Button> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IdentityEditor({ value, onChange, disabled }: {
  value: StoryBibleContent["identity"]; onChange: (value: StoryBibleContent["identity"]) => void; disabled?: boolean;
}) {
  return (
    <div className="grid gap-3">
      <TextField label="Title" value={value.title} onChange={(v) => onChange({ ...value, title: v })} max={120} disabled={disabled} />
      <StringListField label="Genres" value={value.genres} onChange={(v) => onChange({ ...value, genres: v })} min={1} max={4} itemMax={80} disabled={disabled} />
      <StringListField label="Subgenres" value={value.subgenres} onChange={(v) => onChange({ ...value, subgenres: v })} max={6} itemMax={80} disabled={disabled} />
      <TextAreaField label="Central premise" value={value.centralPremise} onChange={(v) => onChange({ ...value, centralPremise: v })} max={2000} disabled={disabled} />
      <TextAreaField label="Narrative concept" value={value.narrativeConcept} onChange={(v) => onChange({ ...value, narrativeConcept: v })} max={1800} disabled={disabled} />
      <TextAreaField label="Tone and atmosphere" value={value.toneAndAtmosphere} onChange={(v) => onChange({ ...value, toneAndAtmosphere: v })} max={1000} disabled={disabled} />
      <TextField label="Target audience" value={value.targetAudience} onChange={(v) => onChange({ ...value, targetAudience: v })} max={500} disabled={disabled} />
      <TextAreaField label="Central conflict" value={value.centralConflict} onChange={(v) => onChange({ ...value, centralConflict: v })} max={1200} disabled={disabled} />
    </div>
  );
}

function WorldEditor({ value, onChange, disabled }: {
  value: StoryBibleContent["world"]; onChange: (value: StoryBibleContent["world"]) => void; disabled?: boolean;
}) {
  return (
    <div className="grid gap-3">
      <TextAreaField label="Description" value={value.description} onChange={(v) => onChange({ ...value, description: v })} max={1800} disabled={disabled} />
      <CardListField<Location>
        label="Geography and locations"
        items={value.geographyAndLocations}
        onChange={(v) => onChange({ ...value, geographyAndLocations: v })}
        min={2} max={12} disabled={disabled} itemNoun="location"
        createItem={() => ({ name: "", description: "", storyFunction: "" })}
        renderItem={(item, update) => (
          <div className="grid gap-2">
            <TextField label="Name" value={item.name} onChange={(v) => update({ ...item, name: v })} max={120} disabled={disabled} />
            <TextAreaField label="Description" value={item.description} onChange={(v) => update({ ...item, description: v })} max={700} disabled={disabled} />
            <TextAreaField label="Story function" value={item.storyFunction} onChange={(v) => update({ ...item, storyFunction: v })} max={500} disabled={disabled} />
          </div>
        )}
      />
      <StringListField label="Social structures and cultures" value={value.socialStructuresAndCultures} onChange={(v) => onChange({ ...value, socialStructuresAndCultures: v })} max={10} itemMax={700} disabled={disabled} />
      <StringListField label="History and past events" value={value.historyAndPastEvents} onChange={(v) => onChange({ ...value, historyAndPastEvents: v })} max={12} itemMax={700} disabled={disabled} />
      <StringListField label="Rules" value={value.rules} onChange={(v) => onChange({ ...value, rules: v })} max={16} itemMax={500} disabled={disabled} />
      <CardListField<WorldSystem>
        label="Defining systems"
        items={value.definingSystems}
        onChange={(v) => onChange({ ...value, definingSystems: v })}
        max={8} disabled={disabled} itemNoun="system"
        createItem={() => ({ name: "", description: "", limitations: [], consequences: [] })}
        renderItem={(item, update) => (
          <div className="grid gap-2">
            <TextField label="Name" value={item.name} onChange={(v) => update({ ...item, name: v })} max={120} disabled={disabled} />
            <TextAreaField label="Description" value={item.description} onChange={(v) => update({ ...item, description: v })} max={700} disabled={disabled} />
            <StringListField label="Limitations" value={item.limitations} onChange={(v) => update({ ...item, limitations: v })} max={8} itemMax={400} disabled={disabled} />
            <StringListField label="Consequences" value={item.consequences} onChange={(v) => update({ ...item, consequences: v })} max={8} itemMax={400} disabled={disabled} />
          </div>
        )}
      />
    </div>
  );
}

function CharactersEditor({ value, onChange, disabled }: {
  value: StoryBibleContent["characters"]; onChange: (value: StoryBibleContent["characters"]) => void; disabled?: boolean;
}) {
  return (
    <div className="grid gap-3">
      <CardListField<Character>
        label="Characters"
        items={value.characters}
        onChange={(v) => onChange({ ...value, characters: v })}
        min={2} max={16} disabled={disabled} itemNoun="character"
        createItem={emptyCharacter}
        renderItem={(item, update) => (
          <div className="grid gap-2">
            <TextField label="Name" value={item.name} onChange={(v) => update({ ...item, name: v })} max={80} disabled={disabled} />
            <EnumField label="Story role" value={item.storyRole} onChange={(v) => update({ ...item, storyRole: v as Character["storyRole"] })} options={STORY_ROLES} disabled={disabled} />
            <TextAreaField label="Role description" value={item.roleDescription} onChange={(v) => update({ ...item, roleDescription: v })} max={400} disabled={disabled} />
            <TextAreaField label="Physical description" value={item.physicalDescription} onChange={(v) => update({ ...item, physicalDescription: v })} max={600} disabled={disabled} />
            <TextAreaField label="Personality" value={item.personality} onChange={(v) => update({ ...item, personality: v })} max={700} disabled={disabled} />
            <TextAreaField label="Background" value={item.background} onChange={(v) => update({ ...item, background: v })} max={900} disabled={disabled} />
            <StringListField label="Motivations" value={item.motivations} onChange={(v) => update({ ...item, motivations: v })} max={8} itemMax={400} disabled={disabled} />
            <StringListField label="Fears and weaknesses" value={item.fearsAndWeaknesses} onChange={(v) => update({ ...item, fearsAndWeaknesses: v })} max={8} itemMax={400} disabled={disabled} />
            <StringListField label="Abilities and limitations" value={item.abilitiesAndLimitations} onChange={(v) => update({ ...item, abilitiesAndLimitations: v })} max={8} itemMax={400} disabled={disabled} />
            <CardListField<Relationship>
              label="Relationships"
              items={item.relationships}
              onChange={(v) => update({ ...item, relationships: v })}
              max={12} disabled={disabled} itemNoun="relationship"
              createItem={() => ({ characterName: "", relationship: "", tensionOrChange: "" })}
              renderItem={(rel, relUpdate) => (
                <div className="grid gap-2">
                  <TextField label="Character name" value={rel.characterName} onChange={(v) => relUpdate({ ...rel, characterName: v })} max={80} disabled={disabled} />
                  <TextField label="Relationship" value={rel.relationship} onChange={(v) => relUpdate({ ...rel, relationship: v })} max={300} disabled={disabled} />
                  <TextAreaField label="Tension or change" value={rel.tensionOrChange} onChange={(v) => relUpdate({ ...rel, tensionOrChange: v })} max={400} disabled={disabled} />
                </div>
              )}
            />
            <StringListField label="Secrets" value={item.secrets} onChange={(v) => update({ ...item, secrets: v })} max={6} itemMax={400} disabled={disabled} />
            <TextAreaField label="Development potential" value={item.developmentPotential} onChange={(v) => update({ ...item, developmentPotential: v })} max={700} disabled={disabled} />
          </div>
        )}
      />
      <StringListField label="Relationship dynamics" value={value.relationshipDynamics} onChange={(v) => onChange({ ...value, relationshipDynamics: v })} max={12} itemMax={500} disabled={disabled} />
    </div>
  );
}

function NarrativeEditor({ value, onChange, disabled }: {
  value: StoryBibleContent["narrative"]; onChange: (value: StoryBibleContent["narrative"]) => void; disabled?: boolean;
}) {
  return (
    <div className="grid gap-3">
      <TextAreaField label="Main storyline" value={value.mainStoryline} onChange={(v) => onChange({ ...value, mainStoryline: v })} max={1800} disabled={disabled} />
      <StringListField label="Major conflicts" value={value.majorConflicts} onChange={(v) => onChange({ ...value, majorConflicts: v })} max={10} itemMax={600} disabled={disabled} />
      <TextAreaField label="Long-term direction" value={value.longTermDirection} onChange={(v) => onChange({ ...value, longTermDirection: v })} max={1500} disabled={disabled} />
      <StringListField label="Subplots" value={value.subplots} onChange={(v) => onChange({ ...value, subplots: v })} max={10} itemMax={600} disabled={disabled} />
      <StringListField label="Unresolved mysteries" value={value.unresolvedMysteries} onChange={(v) => onChange({ ...value, unresolvedMysteries: v })} max={10} itemMax={500} disabled={disabled} />
      <StringListField label="Potential future revelations" value={value.potentialFutureRevelations} onChange={(v) => onChange({ ...value, potentialFutureRevelations: v })} max={10} itemMax={500} disabled={disabled} />
      <StringListField label="Major narrative questions" value={value.majorNarrativeQuestions} onChange={(v) => onChange({ ...value, majorNarrativeQuestions: v })} max={10} itemMax={400} disabled={disabled} />
      <TextAreaField label="Serialized ending guidance" value={value.serializedEndingGuidance} onChange={(v) => onChange({ ...value, serializedEndingGuidance: v })} max={800} disabled={disabled} />
    </div>
  );
}

function GuidelinesEditor({ value, onChange, disabled }: {
  value: StoryBibleContent["guidelines"]; onChange: (value: StoryBibleContent["guidelines"]) => void; disabled?: boolean;
}) {
  return (
    <div className="grid gap-3">
      <StringListField label="Main themes" value={value.mainThemes} onChange={(v) => onChange({ ...value, mainThemes: v })} max={8} itemMax={400} disabled={disabled} />
      <StringListField label="Secondary themes" value={value.secondaryThemes} onChange={(v) => onChange({ ...value, secondaryThemes: v })} max={10} itemMax={400} disabled={disabled} />
      <TextAreaField label="Storytelling style" value={value.storytellingStyle} onChange={(v) => onChange({ ...value, storytellingStyle: v })} max={800} disabled={disabled} />
      <StringListField label="Boundaries" value={value.boundaries} onChange={(v) => onChange({ ...value, boundaries: v })} max={16} itemMax={400} disabled={disabled} />
      <StringListField label="Must remain consistent" value={value.mustRemainConsistent} onChange={(v) => onChange({ ...value, mustRemainConsistent: v })} max={20} itemMax={400} disabled={disabled} />
    </div>
  );
}

function CanonEditor({ value, onChange, disabled }: {
  value: StoryBibleContent["canon"]; onChange: (value: StoryBibleContent["canon"]) => void; disabled?: boolean;
}) {
  return (
    <div className="grid gap-3">
      <StringListField label="Confirmed facts" value={value.confirmedFacts} onChange={(v) => onChange({ ...value, confirmedFacts: v })} max={40} itemMax={500} disabled={disabled} />
      <StringListField label="Proposed details" value={value.proposedDetails} onChange={(v) => onChange({ ...value, proposedDetails: v })} max={30} itemMax={500} disabled={disabled} />
      <StringListField label="Unresolved questions" value={value.unresolvedQuestions} onChange={(v) => onChange({ ...value, unresolvedQuestions: v })} max={20} itemMax={400} disabled={disabled} />
      <StringListField label="Hidden information" value={value.hiddenInformation} onChange={(v) => onChange({ ...value, hiddenInformation: v })} max={16} itemMax={500} disabled={disabled} />
      <CardListField<CharacterKnowledge>
        label="Character knowledge"
        items={value.characterKnowledge}
        onChange={(v) => onChange({ ...value, characterKnowledge: v })}
        max={16} disabled={disabled} itemNoun="entry"
        createItem={() => ({ characterName: "", knows: [], believes: [] })}
        renderItem={(item, update) => (
          <div className="grid gap-2">
            <TextField label="Character name" value={item.characterName} onChange={(v) => update({ ...item, characterName: v })} max={80} disabled={disabled} />
            <StringListField label="Knows" value={item.knows} onChange={(v) => update({ ...item, knows: v })} max={10} itemMax={400} disabled={disabled} />
            <StringListField label="Believes" value={item.believes} onChange={(v) => update({ ...item, believes: v })} max={10} itemMax={400} disabled={disabled} />
          </div>
        )}
      />
      <StringListField label="Audience knowledge" value={value.audienceKnowledge} onChange={(v) => onChange({ ...value, audienceKnowledge: v })} max={20} itemMax={400} disabled={disabled} />
    </div>
  );
}
