"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useParams } from "next/navigation";
import { StageLayout } from "@/components/workflow/StageLayout";
import { StoryBibleEditor } from "@/components/projects/StoryBibleEditor";
import { ImportDialog } from "@/components/projects/ImportDialog";
import { ExportDialog } from "@/components/projects/ExportDialog";
import { Button } from "@/components/ui/button";
import { useProject } from "@/hooks/useProjects";
import { useWorkflow } from "@/hooks/useWorkflow";
import { useStoryBible, useSaveStoryBible } from "@/hooks/useStoryBible";
import { importStoryBible } from "@/lib/utils/storyBibleImport";
import { storyBibleToMarkdown, storyBibleFilename } from "@/lib/utils/storyBibleExport";

export default function StoryBiblePage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const projectId = params.projectId;
  const query = useProject(projectId);
  const project = query.data?.project;
  const workflow = useWorkflow(projectId);
  const bibleQuery = useStoryBible(projectId);
  const saveBible = useSaveStoryBible(projectId);
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [importWarning, setImportWarning] = useState<string | null>(null);

  const bibleApproved = workflow.data?.bible.approved ?? false;
  const bibleNeedsReview = workflow.data?.bible.needsReview ?? false;
  const bible = bibleQuery.data?.bible;

  async function handleImport(content: string, format: "markdown" | "json" | "text") {
    setImportWarning(null);
    const result = importStoryBible(content, format);
    if (result.warnings.length > 0) setImportWarning(result.warnings.join(" "));
    await saveBible.mutateAsync(result.draft);
  }

  const exportFilename = project ? storyBibleFilename(project.title, "json") : "story-bible.json";
  const exportMarkdown = bible ? storyBibleToMarkdown(bible) : undefined;

  return (
    <StageLayout projectId={projectId} stage="bible">
      {project ? (
        <>
          {bibleNeedsReview ? (
            <div className="mb-6 rounded border border-[#6b3a32] p-4">
              <p className="text-sm text-[#dfc18a]">
                The approved story has changed since this Story Bible was approved. Review the Bible and re-approve to keep canon up to date.
              </p>
            </div>
          ) : null}
          {importWarning ? (
            <div className="mb-4 rounded border border-[#6b3a32] p-3">
              <p className="text-sm text-[#dfc18a]">{importWarning}</p>
            </div>
          ) : null}
          <div className="mb-4 flex gap-2">
            <Button variant="quiet" size="sm" onClick={() => setShowImport(true)}>Import</Button>
            <Button variant="quiet" size="sm" onClick={() => setShowExport(true)}>Export</Button>
          </div>
          <StoryBibleEditor
            projectId={project.id}
            initialIdea={project.originalStoryIdea}
            initialTitle={project.title}
          />
          {bibleApproved ? (
            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={() => router.push(`/projects/${projectId}/story`)}>
                Continue to Story Draft →
              </Button>
            </div>
          ) : null}
          <ImportDialog
            open={showImport}
            onClose={() => { setShowImport(false); setImportWarning(null); }}
            onImport={handleImport}
            title="Import Story Bible"
          />
          <ExportDialog
            open={showExport}
            onClose={() => setShowExport(false)}
            data={bible ?? project}
            title="Export Story Bible"
            filename={exportFilename}
            markdownContent={exportMarkdown}
          />
        </>
      ) : null}
    </StageLayout>
  );
}
