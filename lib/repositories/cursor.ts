import { z } from "zod";

const cursorSchema = z.object({
  updatedAt: z.string().datetime(),
  id: z.string().regex(/^[a-f0-9]{24}$/i),
});

export type ListCursor = z.infer<typeof cursorSchema>;

export function encodeCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(token: string | null): ListCursor | null {
  if (!token) return null;
  try {
    const json = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    return cursorSchema.parse(json);
  } catch {
    throw new Error("invalid_cursor");
  }
}
