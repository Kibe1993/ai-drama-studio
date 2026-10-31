"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ASPECT_RATIOS,
  DURATION_OPTIONS,
  GENRES,
  LANGUAGES,
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
        <Field label="Genre" error={form.formState.errors.genre?.message}>
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
              form.setValue("targetDurationSeconds", Number(event.target.value) as 60 | 120 | 180, {
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
