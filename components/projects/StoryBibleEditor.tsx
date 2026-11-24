"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/hooks/api";
import { useApproveStoryBible, useSaveStoryBible, useStoryBible } from "@/hooks/useStoryBible";
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
  const [draft, setDraft] = useState<StoryBibleDraft>(EMPTY);
  const bible = query.data?.bible;

  useEffect(() => {
    if (!bible) return;
    setDraft({ premise: bible.premise, worldRules: bible.worldRules, themes: bible.themes, boundaries: bible.boundaries, canonFacts: bible.canonFacts,
      content: bible.content, sourceIdea: bible.sourceIdea, creativeDirection: bible.creativeDirection, creatorDecisions: bible.creatorDecisions });
  }, [bible]);

  const mutationPending = save.isPending || approve.isPending;
  const original = bible ? { premise: bible.premise, worldRules: bible.worldRules, themes: bible.themes, boundaries: bible.boundaries, canonFacts: bible.canonFacts } : null;
  const saved = Boolean(bible && original && JSON.stringify({ premise: draft.premise, worldRules: draft.worldRules, themes: draft.themes, boundaries: draft.boundaries, canonFacts: draft.canonFacts }) === JSON.stringify(original));
  const unchangedSinceApproval = Boolean(bible && bible.draftRevision === bible.approvedVersion);
  const error = save.error ?? approve.error;
  const displayError = error instanceof ApiError ? error.message : error ? "The Story Bible request could not be completed." : null;

  return (
    <section className="mt-10 border-y border-[#2e2a25] py-6">
      <h2 className="font-display text-3xl">Story Bible</h2>
      <p className="mt-2 max-w-3xl text-sm text-[#a39b8f]">Review and edit the Story Bible below. Nothing becomes canon until you approve it.</p>
      {query.isLoading ? <p className="mt-4 text-sm text-[#a39b8f]">Loading Story Bible</p> : null}
      {query.isError ? <p role="alert" className="mt-4 text-sm text-[#e7b2a8]">The Story Bible could not be loaded.</p> : null}

      {bible ? <div className="mt-5 grid gap-4">
        {displayError ? <p role="alert" className="text-sm text-[#e7b2a8]">{displayError}</p> : null}

        {bible.content ? <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-2xl">Review draft — revision {bible.draftRevision}</h3>
              <p className="mt-1 text-xs text-[#a39b8f]">Approving locks this draft as the canon production uses. You can keep editing and re-approve anytime.</p>
            </div>
            <Button disabled={mutationPending || !saved || unchangedSinceApproval} onClick={() => approve.mutate({ expectedVersion: bible.approvedVersion, expectedDraftRevision: bible.draftRevision })}>{approve.isPending ? "Approving" : `Approve as canon — v${bible.approvedVersion + 1}`}</Button>
          </div>
          {!saved ? <p className="text-xs text-[#dfc18a]">You have unsaved manual edits in the legacy fields below — save them before approving.</p> : null}
          {unchangedSinceApproval ? <p className="text-xs text-[#a39b8f]">This draft is already approved at v{bible.approvedVersion} — make a change before approving again.</p> : null}
          {SECTIONS.map((section) => <details key={section} className="rounded border border-[#39342d] p-4" open={section === "identity"}>
            <summary className="cursor-pointer font-medium">{LABELS[section]}</summary>
            <div className="mt-4"><ReadableValue value={bible.content?.[section]} /></div>
          </details>)}
        </div> : null}

        <details className="grid gap-4 rounded border border-[#39342d] p-4">
          <summary className="cursor-pointer font-medium">Manual five-field draft (legacy)</summary>
          <p className="text-xs text-[#a39b8f]">Editable fallback fields kept for older records. Structured drafts live in the six sections above — you normally do not need these. Changes here require &ldquo;Save manual edits&rdquo; before they count.</p>
          <label className="grid gap-2 text-sm"><span>Premise</span><textarea disabled={readOnly} className="studio-field min-h-24" maxLength={2000} value={draft.premise} onChange={(e) => setDraft({ ...draft, premise: e.target.value })} /></label>
          <ListField disabled={readOnly} label="World rules" value={draft.worldRules ?? []} onChange={(worldRules) => setDraft({ ...draft, worldRules })} />
          <ListField disabled={readOnly} label="Themes" value={draft.themes ?? []} onChange={(themes) => setDraft({ ...draft, themes })} />
          <ListField disabled={readOnly} label="Story boundaries" value={draft.boundaries ?? []} onChange={(boundaries) => setDraft({ ...draft, boundaries })} />
          <ListField disabled={readOnly} label="Canon facts" value={draft.canonFacts ?? []} onChange={(canonFacts) => setDraft({ ...draft, canonFacts })} />
          {!readOnly ? <Button variant="quiet" className="w-fit" disabled={mutationPending || saved} onClick={() => save.mutate(draft)}>{save.isPending ? "Saving" : saved ? "Manual edits saved" : "Save manual edits"}</Button> : null}
        </details>

        <p className="text-xs text-[#a39b8f]">Approved version: {bible.approvedVersion || "none"} · draft revision {bible.draftRevision}. Each approval stores an immutable canon snapshot.</p>
        {!readOnly && !bible.content ? <div className="flex flex-wrap gap-3">
          <Button disabled={mutationPending || !saved || unchangedSinceApproval || (!bible.premise.trim() && !bible.canonFacts.length)} onClick={() => approve.mutate({ expectedVersion: bible.approvedVersion, expectedDraftRevision: bible.draftRevision })}>{approve.isPending ? "Approving" : `Approve as canon — v${bible.approvedVersion + 1}`}</Button>
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
