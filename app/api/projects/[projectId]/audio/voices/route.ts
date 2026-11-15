import { logged } from "@/lib/http/logged";
import { readActor } from "@/lib/http/request";
import { jsonData } from "@/lib/http/errors";
import { KOKORO_VOICES, KOKORO_LANGUAGE_NAMES } from "@/lib/providers/media/audio/kokoroVoices";

type Context = { params: Promise<{ projectId: string }> };

export function GET(request: Request, _context: Context) {
  return logged(request, async () => {
    await readActor();
    return jsonData({
      voices: KOKORO_VOICES,
      languages: KOKORO_LANGUAGE_NAMES,
    });
  });
}