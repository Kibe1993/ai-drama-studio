"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ASPECT_RATIOS,
  DURATION_OPTIONS,
  GENRES,
  LANGUAGES,
  PRODUCTION_MODES,
  PRODUCTION_TYPES,
  VISUAL_STYLES,
} from "@/lib/domain/projectCatalog";
import { projectInputSchema, type ProjectInput } from "@/lib/validation/project";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const emptyProject: ProjectInput = {
  title: "",
  originalStoryIdea: "",
  genre: "romance",
  language: "en",
  visualStyle: "realistic",
  tone: "dramatic",
  targetDurationSeconds: 60,
  aspectRatio: "16:9",
  productionType: "fictional_drama",
  productionMode: "standalone",
};

export function ProjectForm({
  initial,
  submitLabel,
  pending,
  onSubmit,
}: {
  initial: ProjectInput;
  submitLabel: string;
  pending: boolean;
  onSubmit: (values: ProjectInput) => Promise<void>;
}) {
  const form = useForm<ProjectInput>({
    resolver: zodResolver(projectInputSchema),
    defaultValues: initial,
  });

  return (
    <form
      className="grid gap-5"
      onSubmit={form.handleSubmit(async (values) => {
        await onSubmit(values);
      })}
    >
      <Field label="Title" error={form.formState.errors.title?.message}>
        <Input {...form.register("title")} maxLength={120} />
      </Field>
      <Field label="Story idea" error={form.formState.errors.originalStoryIdea?.message}>
        <Textarea
          {...form.register("originalStoryIdea")}
          placeholder="Describe the story in ordinary language."
          maxLength={8000}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Genre / focus" error={form.formState.errors.genre?.message}>
          <select className="studio-field" {...form.register("genre")}>
            {GENRES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Language" error={form.formState.errors.language?.message}>
          <select className="studio-field" {...form.register("language")}>
            {LANGUAGES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Duration" error={form.formState.errors.targetDurationSeconds?.message}>
          <select
            className="studio-field"
            value={form.watch("targetDurationSeconds")}
            onChange={(event) =>
              form.setValue("targetDurationSeconds", Number(event.target.value), {
                shouldValidate: true,
              })
            }
          >
            {DURATION_OPTIONS.map((item) => (
              <option key={item.seconds} value={item.seconds}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Production type" error={form.formState.errors.productionType?.message}>
          <select className="studio-field" {...form.register("productionType")}>
            {PRODUCTION_TYPES.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
          {(() => {
            const selected = PRODUCTION_TYPES.find((item) => item.id === form.watch("productionType"));
            return selected ? (
              <span className="grid gap-1 text-xs text-[#a39b8f]">
                <span>{selected.description}</span>
                <span>Example: {selected.example}</span>
                {selected.id === "documentary_educational" ? (
                  <span className="text-[#e7d0a7]">Factual claims need source research and human verification; that workflow is not implemented yet.</span>
                ) : null}
              </span>
            ) : null;
          })()}
        </Field>
        <Field label="Continuity mode" error={form.formState.errors.productionMode?.message}>
          <select className="studio-field" {...form.register("productionMode")}>
            {PRODUCTION_MODES.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
          <span className="text-xs text-[#a39b8f]">
            Episode-to-episode story memory is a planned phase; this setting is saved with the project now.
          </span>
        </Field>
        <Field label="Aspect ratio" error={form.formState.errors.aspectRatio?.message}>
          <select className="studio-field" {...form.register("aspectRatio")}>
            {ASPECT_RATIOS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Visual style" error={form.formState.errors.visualStyle?.message}>
          <select className="studio-field" {...form.register("visualStyle")}>
            {VISUAL_STYLES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tone" error={form.formState.errors.tone?.message}>
          <Input {...form.register("tone")} maxLength={80} />
        </Field>
      </div>
      <p className="text-xs text-[#a39b8f]">
        Duration sets the screenplay target. Real video generation and final rendering are not available yet.
      </p>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <Label>{label}</Label>
      {children}
      {error ? <span className="text-sm text-[#e7b2a8]">{error}</span> : null}
    </label>
  );
}
