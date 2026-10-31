import "server-only";
import type { RequestAuth } from "@/lib/auth/session";
import { readPreferences, updateLanguage, upsertStudioUser } from "@/lib/repositories/userRepository";
import type { AccountUpdate } from "@/lib/validation/project";

export async function getAccount(actor: RequestAuth) {
  await upsertStudioUser(actor);
  const preferences = await readPreferences(actor.userId);
  return {
    email: actor.email,
    name: actor.name,
    preferences,
  };
}

export async function updateAccount(actor: RequestAuth, input: AccountUpdate) {
  await upsertStudioUser(actor);
  await updateLanguage(actor.userId, input.language);
  return getAccount(actor);
}
