#!/usr/bin/env python3
"""Kokoro TTS bridge script.

Reads a JSON request from stdin, generates audio with Kokoro, and writes a
single WAV file. Outputs a JSON result to stdout.

Request (stdin):
{
  "text": "Hello world",
  "voice": "af_heart",
  "speed": 1.0,
  "output_path": "C:/path/to/output.wav",
  "lang_code": "a"
}

Result (stdout):
{ "ok": true, "output_path": "...", "sample_rate": 24000, "duration_seconds": 1.5, "num_chunks": 2 }
or
{ "ok": false, "error": "message" }
"""

import json
import sys
import os


def main():
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            print(json.dumps({"ok": False, "error": "No input provided"}))
            sys.exit(1)

        request = json.loads(raw)
        text = request.get("text", "").strip()
        voice = request.get("voice", "af_heart")
        speed = float(request.get("speed", 1.0))
        output_path = request.get("output_path", "")
        lang_code = request.get("lang_code", "a")

        if not text:
            print(json.dumps({"ok": False, "error": "text is required"}))
            sys.exit(1)
        if not output_path:
            print(json.dumps({"ok": False, "error": "output_path is required"}))
            sys.exit(1)

        from kokoro import KPipeline
        import soundfile as sf
        import numpy as np

        pipeline = KPipeline(lang_code=lang_code)
        chunks = []
        for _graphemes, _phonemes, audio in pipeline(text, voice=voice, speed=speed):
            if audio is not None and len(audio) > 0:
                chunks.append(np.asarray(audio, dtype=np.float32))

        if not chunks:
            print(json.dumps({"ok": False, "error": "No audio generated for the given text"}))
            sys.exit(1)

        combined = np.concatenate(chunks) if len(chunks) > 1 else chunks[0]
        sample_rate = 24000
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        sf.write(output_path, combined, sample_rate, format="WAV", subtype="PCM_16")

        duration_seconds = len(combined) / sample_rate
        result = {
            "ok": True,
            "output_path": output_path,
            "sample_rate": sample_rate,
            "duration_seconds": round(duration_seconds, 3),
            "num_chunks": len(chunks),
            "num_samples": int(len(combined)),
        }
        print(json.dumps(result))

    except ImportError as e:
        print(json.dumps({"ok": False, "error": f"Import error: {e}"}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()