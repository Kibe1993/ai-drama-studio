"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { StageLayout } from "@/components/workflow/StageLayout";
import { StoryDraftWorkspace } from "@/components/workflow/StoryDraftWorkspace";
import { ImportDialog } from "@/components/projects/ImportDialog";
import { ExportDialog } from "@/components/projects/ExportDialog";
import { Button } from "@/components/ui/button";
import { useProject } from "@/hooks/useProjects";
import { useStoryDraft } from "@/hooks/useStoryDraft";
import { api } from "@/hooks/api";

export default function StoryDraftPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const query = useProject(projectId);
  const project = query.data?.project;
  const storyQuery = useStoryDraft(projectId);
  const story = storyQuery.data?.story ?? null;
  const queryClient = useQueryClient();
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  async function handleImport(content: string, format: "markdown" | "json" | "text") {
    let body: Record<string, unknown>;
    if (format === "json") {
      body = JSON.parse(content);
    } else {
      body = {
        title: "Imported Story",
        synopsis: content.slice(0, 2000),
        screenplay: [{ heading: "SCENE 1", action: content, dialogue: [] }],
      };
    }
    setImporting(true);
    setImportError(null);
    try {
      await api(`/api/projects/${projectId}/story-draft`, {
        method: "POST",
        body: JSON.stringify({ operation: "generate", instruction: JSON.stringify(body), creativeDirection: "Imported content" }),
      });
      await queryClient.invalidateQueries({ queryKey: ["story-draft", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["projects", projectId] });
      setShowImport(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Import failed";
      setImportError(msg);
      throw new Error(msg);
    } finally {
      setImporting(false);
    }
  }

  return (
    <StageLayout projectId={projectId} stage="story">
      {query.isLoading ? <p className="text-[#a39b8f]">Loading…</p> : null}
      {query.isError ? <p className="text-[#e7b2a8]">Failed to load project.</p> : null}
      {project ? (
        <>
          <div className="mb-4 flex gap-2">
            <Button variant="quiet" size="sm" onClick={() => setShowImport(true)}>Import</Button>
            <Button variant="quiet" size="sm" onClick={() => setShowExport(true)} disabled={!story}>Export</Button>
          </div>
          <StoryDraftWorkspace project={project} />
          <ImportDialog
            open={showImport}
            onClose={() => { setShowImport(false); setImportError(null); }}
            onImport={handleImport}
            title="Import Story"
          />
          {importError ? <p className="mt-2 text-[#e7b2a8]">{importError}</p> : null}
          {importing ? <p className="mt-2 text-[#a39b8f]">Importing…</p> : null}
          <ExportDialog
            open={showExport}
            onClose={() => setShowExport(false)}
            data={story ?? project}
            title="Export Story"
            filename={story ? `story-draft.${story.id}` : "project"}
          />
        </>
      ) : null}
    </StageLayout>
  );
}
