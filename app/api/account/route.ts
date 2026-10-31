import { readActor, readJson } from "@/lib/http/request";
import { assertRateLimit } from "@/lib/http/rateLimit";
import { errorResponse, jsonData, toErrorResponse } from "@/lib/http/errors";
import { getAccount, updateAccount } from "@/lib/services/accountService";
import { accountUpdateSchema } from "@/lib/validation/project";

export async function GET() {
  try {
    const actor = await readActor();
    return jsonData(await getAccount(actor));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await readActor();
    assertRateLimit(`account-write:${actor.userId}`);
    const parsed = accountUpdateSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return errorResponse(400, "invalid_input", parsed.error.issues[0]?.message ?? "Check the form");
    }
    return jsonData(await updateAccount(actor, parsed.data));
  } catch (error) {
    return toErrorResponse(error);
  }
}
