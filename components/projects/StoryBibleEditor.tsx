"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/hooks/api";
import {
  useApproveStoryBible, useGenerateStoryBible, useRegenerateStoryBible,
  useRegenerateStoryBibleSection, useReviseStoryBible, useSaveStoryBible, useStoryBible,
} from "@/hooks/useStoryBible";
import type { StoryBibleDraft, StoryBibleSection } from "@/lib/validation/storyBible";

const EMPTY: StoryBibleDraft = { premise: "", worldRules: [], themes: [], boundaries: [], canonFacts: [], sourceIdea: "", creativeDirection: "", creatorDecisions: [] };
const SECTIONS: StoryBibleSection[] = ["identity", "world", "characters", "narrative", "guidelines", "canon"];
const LABELS: Record<StoryBibleSection, string> = {
  identity: "Series identity", world: "World and setting", characters: "Characters and relationships",
  narrative: "Narrative direction", guidelines: "Creative guidelines", canon: "Canon and knowledge",
};

function lines(value: string): string[] { return value.split("\n").map((line) => line.trim()).filter(Boolean); }

export function StoryBibleEditor({ projectId, readOnly = false, initialIdea = "", initialTitle = "" }: {
  projectId: string; readOnly?: boolean; initialIdea?: string; initialTitle?: string;
}) {
  const query = useStoryBible(projectId);
  const save = useSaveStoryBible(projectId);
  const approve = useApproveStoryBible(projectId);
  const generate = useGenerateStoryBible(projectId);
  const regenerate = useRegenerateStoryBible(projectId);
  const revise = useReviseStoryBible(projectId);
  const regenerateSection = useRegenerateStoryBibleSection(projectId);
  const [draft, setDraft] = useState<StoryBibleDraft>(EMPTY);
  const [idea, setIdea] = useState(initialIdea);
  const [title, setTitle] = useState(initialTitle);
  const [direction, setDirection] = useState("");
  const [instruction, setInstruction] = useState("");
  const [sectionInstruction, setSectionInstruction] = useState("");
  const [fresh, setFresh] = useState(false);
  const bible = query.data?.bible;

  useEffect(() => {
    if (!bible) return;
    setDraft({ premise: bible.premise, worldRules: bible.worldRules, themes: bible.themes, boundaries: bible.boundaries, canonFacts: bible.canonFacts,
      content: bible.content, sourceIdea: bible.sourceIdea, creativeDirection: bible.creativeDirection, creatorDecisions: bible.creatorDecisions });
    if (bible.sourceIdea) setIdea(bible.sourceIdea);
    if (bible.content?.identity.title) setTitle(bible.content.identity.title);
    if (bible.creativeDirection) setDirection(bible.creativeDirection);
  }, [bible]);

  const jobPending = bible?.generationStatus === "queued" || bible?.generationStatus === "processing";
  const mutationPending = generate.isPending || regenerate.isPending || revise.isPending || regenerateSection.isPending || save.isPending || approve.isPending;
  const original = bible ? { premise: bible.premise, worldRules: bible.worldRules, themes: bible.themes, boundaries: bible.boundaries, canonFacts: bible.canonFacts } : null;
  const saved = Boolean(bible && original && JSON.stringify({ premise: draft.premise, worldRules: draft.worldRules, themes: draft.themes, boundaries: draft.boundaries, canonFacts: draft.canonFacts }) === JSON.stringify(original));
  const error = generate.error ?? regenerate.error ?? revise.error ?? regenerateSection.error ?? save.error ?? approve.error;
  const aiError = error instanceof ApiError ? error.message : error ? "The Story Bible request could not be completed." : bible?.generationError;

  function inputBase() { return { idea: idea.trim() || bible?.sourceIdea || initialIdea, title: title.trim() || initialTitle, creativeDirection: direction.trim() || bible?.creativeDirection || "" }; }

  return (
    <section className="mt-10 border-y border-[#2e2a25] py-6">
      <h2 className="font-display text-3xl">Story Bible</h2>
      <p className="mt-2 max-w-3xl text-sm text-[#a39b8f]">Start with a story idea. AI develops a detailed series reference for your review; nothing becomes canon until you approve it.</p>
      {query.isLoading ? <p className="mt-4 text-sm text-[#a39b8f]">Loading Story Bible</p> : null}
      {query.isError ? <p role="alert" className="mt-4 text-sm text-[#e7b2a8]">The Story Bible could not be loaded.</p> : null}
      {!readOnly && bible ? <div className="mt-5 grid max-w-3xl gap-3 rounded border border-[#39342d] p-4">
        <h3 className="font-medium">Develop with AI</h3>
        <label className="grid gap-1 text-sm">Story idea<textarea className="studio-field min-h-24" maxLength={8000} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="Describe the story you want to tell" /></label>
        <label className="grid gap-1 text-sm">Optional title<input className="studio-field" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="grid gap-1 text-sm">Optional creative direction<textarea className="studio-field min-h-16" maxLength={4000} value={direction} onChange={(e) => setDirection(e.target.value)} placeholder="Tone, audience, must-have ideas, or boundaries" /></label>
        <div className="flex flex-wrap gap-3">
          <Button disabled={mutationPending || jobPending || !idea.trim()} onClick={() => bible.content
            ? regenerate.mutate({ ...inputBase(), freshInterpretation: false })
            : generate.mutate({ operation: "generate", ...inputBase() })}>{generate.isPending || regenerate.isPending ? "Queueing" : bible.content ? "Develop current draft" : "Create Story Bible"}</Button>
          {bible.content ? <Button variant="quiet" disabled={mutationPending || jobPending} onClick={() => regenerate.mutate({ ...inputBase(), freshInterpretation: fresh })}>{regenerate.isPending ? "Queueing" : "Regenerate full Bible"}</Button> : null}
        </div>
        {bible.content ? <label className="flex items-center gap-2 text-sm text-[#cfc6b8]"><input type="checkbox" checked={fresh} onChange={(e) => setFresh(e.target.checked)} />Start a fresh interpretation (release previously approved creative choices)</label> : null}
      </div> : null}

      {bible ? <div className="mt-5 grid gap-4">
        {bible.generationStatus === "queued" || bible.generationStatus === "processing" ? <p role="status" className="text-sm text-[#dfc18a]">{bible.generationStatus === "queued" ? "Story Bible generation queued…" : "Developing Story Bible…"}</p> : null}
        {aiError ? <p role="alert" className="text-sm text-[#e7b2a8]">{aiError}</p> : null}

        {bible.content ? <div className="grid gap-3">
          <h3 className="font-display text-2xl">Review proposed Story Bible</h3>
          {SECTIONS.map((section) => <details key={section} className="rounded border border-[#39342d] p-4" open={section === "identity"}>
            <summary className="cursor-pointer font-medium">{LABELS[section]}</summary>
            <div className="mt-4"><ReadableValue value={bible.content?.[section]} /></div>
            {!readOnly ? <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
              <input className="studio-field" value={sectionInstruction} maxLength={1200} onChange={(e) => setSectionInstruction(e.target.value)} placeholder="Optional guidance for this section" />
              <Button variant="quiet" disabled={mutationPending || jobPending} onClick={() => regenerateSection.mutate({ section, instruction: sectionInstruction, freshInterpretation: fresh })}>Regenerate section</Button>
            </div> : null}
          </details>)}
          <label className="grid gap-2 text-sm">Request a focused revision<textarea className="studio-field min-h-20" value={instruction} maxLength={2000} onChange={(e) => setInstruction(e.target.value)} placeholder="For example: strengthen the sisters’ rivalry without changing the setting or established facts" /></label>
          {!readOnly ? <Button variant="quiet" className="w-fit" disabled={mutationPending || jobPending || !instruction.trim()} onClick={() => revise.mutate({ instruction, freshInterpretation: fresh })}>Apply revision</Button> : null}
        </div> : null}

        <details className="grid gap-4 rounded border border-[#39342d] p-4">
          <summary className="cursor-pointer font-medium">Legacy five-field draft</summary>
          <p className="text-xs text-[#a39b8f]">These original fields remain editable and are preserved for older records and clients.</p>
          <label className="grid gap-2 text-sm"><span>Premise</span><textarea disabled={readOnly} className="studio-field min-h-24" maxLength={2000} value={draft.premise} onChange={(e) => setDraft({ ...draft, premise: e.target.value })} /></label>
          <ListField disabled={readOnly} label="World rules" value={draft.worldRules ?? []} onChange={(worldRules) => setDraft({ ...draft, worldRules })} />
          <ListField disabled={readOnly} label="Themes" value={draft.themes ?? []} onChange={(themes) => setDraft({ ...draft, themes })} />
          <ListField disabled={readOnly} label="Story boundaries" value={draft.boundaries ?? []} onChange={(boundaries) => setDraft({ ...draft, boundaries })} />
          <ListField disabled={readOnly} label="Canon facts" value={draft.canonFacts ?? []} onChange={(canonFacts) => setDraft({ ...draft, canonFacts })} />
        </details>

        <p className="text-xs text-[#a39b8f]">Approved version: {bible.approvedVersion || "none"}; draft revision {bible.draftRevision}. Approval creates a versioned canon snapshot.</p>
        {!readOnly ? <div className="flex flex-wrap gap-3">
          <Button variant="quiet" disabled={mutationPending || jobPending} onClick={() => save.mutate(draft)}>{save.isPending ? "Saving" : "Save draft"}</Button>
          <Button disabled={mutationPending || jobPending || !saved || (!bible.content && !bible.premise.trim() && !bible.canonFacts.length)} onClick={() => approve.mutate({ expectedVersion: bible.approvedVersion, expectedDraftRevision: bible.draftRevision })}>{approve.isPending ? "Approving" : `Approve version ${bible.approvedVersion + 1}`}</Button>
        </div> : null}
        {bible.approvedSnapshot ? <p className="text-xs text-[#a39b8f]">Production uses approved version {bible.approvedSnapshot.version}. Current draft remains unapproved until you approve it.</p> : null}
      </div> : null}
    </section>
  );
}

function ReadableValue({ value }: { value: unknown }) {
  if (typeof value === "string") return <p className="whitespace-pre-wrap text-sm leading-6 text-[#cfc6b8]">{value || "Not specified"}</p>;
  if (typeof value === "number" || typeof value === "boolean") return <span className="text-sm text-[#cfc6b8]">{String(value)}</span>;
  if (Array.isArray(value)) return value.length ? <ul className="grid list-disc gap-2 pl-5">{value.map((item, index) => <li key={index}><ReadableValue value={item} /></li>)}</ul> : <p className="text-sm text-[#8f887e]">None specified</p>;
  if (value && typeof value === "object") return <dl className="grid gap-3 sm:grid-cols-2">{Object.entries(value).map(([key, child]) => <div key={key}><dt className="text-xs font-medium uppercase tracking-wide text-[#a39b8f]">{key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}</dt><dd className="mt-1"><ReadableValue value={child} /></dd></div>)}</dl>;
  return <p className="text-sm text-[#8f887e]">Not specified</p>;
}

function ListField({ label, value, onChange, disabled }: { label: string; value: string[]; onChange: (value: string[]) => void; disabled: boolean }) {
  return <label className="grid gap-2 text-sm"><span>{label} <span className="text-xs text-[#a39b8f]">(one item per line)</span></span><textarea disabled={disabled} className="studio-field min-h-20" value={value.join("\n")} maxLength={12000} onChange={(e) => onChange(lines(e.target.value))} /></label>;
}
