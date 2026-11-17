"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useResolveFinding, useRevalidateStoryDraft, useStartStoryDraft } from "@/hooks/useStoryDraft";
import { canAcceptAsIntentional } from "@/lib/validation/casna";
import type { EpisodeValidation, EpisodeValidationFinding } from "@/lib/validation/casna";

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  revision_requested: "Revision requested",
  resolved: "Resolved",
  accepted_as_intentional: "Accepted as intentional",
  recheck_required: "Recheck required",
};

const STATUS_COLORS: Record<string, string> = {
  open: "text-[#dfc18a]",
  revision_requested: "text-[#c4a574]",
  resolved: "text-[#7a9a6a]",
  accepted_as_intentional: "text-[#7a9a6a]",
  recheck_required: "text-[#dfc18a]",
};

function findingKey(finding: EpisodeValidationFinding, index: number): string {
  return finding.id ?? `${finding.code ?? ""}:${finding.category}:${finding.sceneNumber ?? 0}:${index}`;
}

function FindingRow({
  finding,
  index,
  projectId,
  storyId,
  disabled,
}: {
  finding: EpisodeValidationFinding;
  index: number;
  projectId: string;
  storyId: string;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [note, setNote] = useState("");
  const resolveFinding = useResolveFinding(projectId, storyId);
  const startDraft = useStartStoryDraft(projectId);

  const key = findingKey(finding, index);
  const status = finding.resolutionStatus ?? "open";
  const isError = finding.severity === "error";
  const canAccept = canAcceptAsIntentional(finding);
  const isResolved = status === "resolved" || status === "accepted_as_intentional";
  const busy = resolveFinding.isPending || startDraft.isPending || disabled;

  function requestRevision() {
    startDraft.mutate({
      operation: "targeted_revision",
      targetFindingId: finding.id,
      instruction: undefined,
    });
  }

  function acceptAsIntentional() {
    if (!note.trim()) return;
    resolveFinding.mutate(
      { findingId: finding.id ?? key, status: "accepted_as_intentional", note: note.trim() },
      { onSuccess: () => { setAccepting(false); setNote(""); } },
    );
  }

  function markResolved() {
    resolveFinding.mutate({ findingId: finding.id ?? key, status: "resolved" });
  }

  return (
    <li className={`rounded border p-3 ${isError ? "border-[#6b3a32]" : "border-[#39342d]"}`}>
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          className="flex-1 text-left"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          <span className={`text-xs font-medium ${isError ? "text-[#e7b2a8]" : "text-[#a39b8f]"}`}>
            [{finding.severity}]
          </span>{" "}
          <span className="text-xs text-[#cfc6b8]">{finding.category}</span>
          {finding.sceneNumber ? <span className="text-xs text-[#a39b8f]"> (scene {finding.sceneNumber})</span> : null}
          {finding.affectedAct ? <span className="text-xs text-[#a39b8f]"> · act {finding.affectedAct}</span> : null}
          {finding.confidence ? <span className="text-xs text-[#a39b8f]"> · {finding.confidence} confidence</span> : null}
          <span className={`ml-2 text-xs ${STATUS_COLORS[status] ?? "text-[#a39b8f]"}`}>· {STATUS_LABELS[status] ?? status}</span>
          <p className="mt-1 text-sm text-[#f3efe6]">{finding.message}</p>
          {finding.title ? <p className="mt-0.5 text-xs text-[#a39b8f]">{finding.title}</p> : null}
        </button>
        <span className="text-xs text-[#a39b8f]">{expanded ? "▲" : "▼"}</span>
      </div>

      {expanded ? (
        <div className="mt-3 grid gap-2 border-t border-[#39342d] pt-3">
          {finding.evidence ? (
            <div>
              <p className="text-xs text-[#a39b8f]">Evidence</p>
              <p className="mt-0.5 text-xs text-[#cfc6b8]">{finding.evidence}</p>
            </div>
          ) : null}
          {finding.expected ? (
            <div>
              <p className="text-xs text-[#a39b8f]">Expected</p>
              <p className="mt-0.5 text-xs text-[#cfc6b8]">{finding.expected}</p>
            </div>
          ) : null}
          {finding.actual ? (
            <div>
              <p className="text-xs text-[#a39b8f]">Actual</p>
              <p className="mt-0.5 text-xs text-[#cfc6b8]">{finding.actual}</p>
            </div>
          ) : null}
          {finding.suggestedCorrection ? (
            <div>
              <p className="text-xs text-[#a39b8f]">Suggested correction</p>
              <p className="mt-0.5 text-xs text-[#cfc6b8]">{finding.suggestedCorrection}</p>
            </div>
          ) : null}
          {finding.code ? (
            <p className="text-xs text-[#a39b8f]">Validator: {finding.code}</p>
          ) : null}
          {finding.resolutionNote ? (
            <div>
              <p className="text-xs text-[#a39b8f]">Creator note</p>
              <p className="mt-0.5 text-xs text-[#cfc6b8]">{finding.resolutionNote}</p>
            </div>
          ) : null}
          {finding.resolvedAt ? (
            <p className="text-xs text-[#a39b8f]">Resolved at {finding.resolvedAt}</p>
          ) : null}

          {!isResolved && !disabled ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="quiet" disabled={busy} onClick={requestRevision}>
                {startDraft.isPending ? "Queuing…" : "Request targeted revision"}
              </Button>
              {canAccept ? (
                accepting ? (
                  <div className="grid gap-2">
                    <textarea
                      className="studio-field min-h-16 text-xs"
                      maxLength={1000}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Explain why this is an intentional creative choice"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" disabled={busy || !note.trim()} onClick={acceptAsIntentional}>
                        {resolveFinding.isPending ? "Saving…" : "Confirm acceptance"}
                      </Button>
                      <Button size="sm" variant="quiet" disabled={busy} onClick={() => { setAccepting(false); setNote(""); }}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant="quiet" disabled={busy} onClick={() => setAccepting(true)}>
                    Accept as intentional
                  </Button>
                )
              ) : (
                <p className="text-xs text-[#a39b8f]">
                  This finding requires canon authorization and cannot be accepted as intentional.
                </p>
              )}
              <Button size="sm" variant="quiet" disabled={busy} onClick={markResolved}>
                Mark resolved
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function ActionableFindings({
  validation,
  projectId,
  storyId,
  disabled,
}: {
  validation: EpisodeValidation;
  projectId: string;
  storyId: string;
  disabled?: boolean;
}) {
  const revalidate = useRevalidateStoryDraft(projectId, storyId);
  if (validation.findings.length === 0) return null;

  const errors = validation.findings.filter((f) => f.severity === "error");
  const warnings = validation.findings.filter((f) => f.severity === "warning");
  const resolved = validation.findings.filter((f) => (f.resolutionStatus ?? "open") === "resolved" || (f.resolutionStatus ?? "open") === "accepted_as_intentional");
  const blocking = errors.filter((f) => (f.resolutionStatus ?? "open") !== "resolved" && (f.resolutionStatus ?? "open") !== "accepted_as_intentional");

  return (
    <section className="rounded border border-[#39342d] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[#cfc6b8]">
          Validation: {validation.passed ? "Passed with notes" : `${blocking.length} blocking error${blocking.length > 1 ? "s" : ""}`}
          {warnings.length > 0 ? `, ${warnings.length} warning${warnings.length > 1 ? "s" : ""}` : ""}
          {resolved.length > 0 ? `, ${resolved.length} resolved` : ""}
        </p>
        <Button size="sm" variant="quiet" disabled={revalidate.isPending || disabled} onClick={() => revalidate.mutate()}>
          {revalidate.isPending ? "Revalidating…" : "Revalidate"}
        </Button>
      </div>
      <ul className="mt-3 grid gap-2">
        {validation.findings.map((finding, index) => (
          <FindingRow
            key={findingKey(finding, index)}
            finding={finding}
            index={index}
            projectId={projectId}
            storyId={storyId}
            disabled={Boolean(disabled)}
          />
        ))}
      </ul>
    </section>
  );
}