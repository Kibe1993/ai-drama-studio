<#
.SYNOPSIS
  Benchmarks Ollama Story Bible section generation under the exact options
  the AI Drama Studio application uses.

.DESCRIPTION
  Tests 4 format modes for 2 sections (identity, characters), 2 runs each:
    1. No format (free generation)
    2. Full JSON schema (format: <schema object>)
    3. Schema with minLength/maxLength/maxItems stripped
    4. format: "json" (plain JSON mode)

  Reports: eval_count, tokens/s, load_duration, prompt_eval_duration,
           total_duration, prompt_eval_count, done_reason

  Usage:  powershell -ExecutionPolicy Bypass -File scripts/ollama-bench.ps1
          powershell -ExecutionPolicy Bypass -File scripts/ollama-bench.ps1 -Model "qwen3:4b-instruct-2507-q4_K_M"
#>

param(
  [string]$BaseUrl = "http://127.0.0.1:11434",
  [string]$Model = "qwen3:4b-instruct-2507-q4_K_M",
  [int]$NumCtx = 8192,
  [double]$Temperature = 0.2,
  [double]$TopP = 0.8,
  [double]$RepeatPenalty = 1.3,
  [int]$RepeatLastN = 128
)

$ErrorActionPreference = "Stop"

# --- Section num_predict caps (from ollama.ts OLLAMA_SECTION_NUM_PREDICT) ---
$SectionCaps = @{
  identity   = 1500
  world      = 2000
  characters = 2500
  narrative  = 2000
  guidelines = 1500
  canon      = 2000
}

# --- System prompt (from storyBibleTask.ts common[] joined) ---
$SystemPrompt = @"
Develop a detailed series bible, not a short pitch or generic list. Make the world, locations, history, rules, consequences, character motives, relationships, conflicts, and long-term story direction causally connected and internally consistent. Give major characters distinct goals, fears, contradictions, relationships, and credible development potential. Include supporting characters and antagonists where the idea supports them; do not add a crowd of interchangeable names. Make world rules operational: explain what they permit, what they forbid, who benefits, who is harmed, and what happens when a rule is broken. Support a long-running serialized story. Leave room for future seasons and do not force a final ending. Separate established truth from proposal. Put only explicit or logically entailed facts in confirmedFacts. Put new creative inventions in proposedDetails. Keep mysteries unresolved in unresolvedQuestions and do not state a guessed solution as fact. Character knowledge and audience knowledge are different. Do not give every character knowledge they have not earned. Stay inside every field limit: descriptions and world-system entries at most 700 characters; character background at most 900; personality and developmentPotential at most 700; centralPremise at most 2000; narrativeConcept and mainStoryline at most 1800; longTermDirection at most 1500; toneAndAtmosphere, storytellingStyle, and serializedEndingGuidance at most 800; targetAudience at most 500; each list item at most 400 characters. Use complete sentences and never omit a required field to add more detail. Respect the creator's language and requested direction. Do not include markdown or commentary; return only the requested JSON. Never repeat a phrase, sentence, or list item. Write each field once, keep it concise, and stop when the schema limit is reached. When the task is a single section, stay inside that section, reuse the established names and facts supplied below, and do not repeat or regenerate other sections.
"@

# --- User prompt for identity section ---
$IdentityPrompt = @"
Mode: section
Working title: Let the story concept determine a compelling title
Production category: short_drama
Production mode: serialized
Genre direction: drama
Language: en
Tone: derive from idea
Creator idea: A small-town diner owner discovers her late husband was living a double life with a second family in the city.
Section guidance:
Write only the series identity. Keep it to a title, genres, a premise and concept, tone, audience, and the central conflict. Do not invent character biographies or detailed world history here; later sections own those.
Generate the identity section for this new Story Bible. Return the requested section and no other section. Stay consistent with any sections already generated.

Required output contract:
Return only the identity section as one JSON object. Follow the section guidance above. Do not wrap it in "section" or "value" keys. Arrays of strings must contain plain strings, not objects. Every array item and every required text field must be non-empty.
Use exactly these keys and nesting; do not rename, replace, or omit any of them:
{"title":"","genres":[""],"subgenres":[""],"centralPremise":"","narrativeConcept":"","toneAndAtmosphere":"","targetAudience":"","centralConflict":""}
"@

# --- User prompt for characters section ---
$CharactersPrompt = @"
Mode: section
Working title: The Second Family
Production category: short_drama
Production mode: serialized
Genre direction: drama
Language: en
Tone: bittersweet
Creator idea: A small-town diner owner discovers her late husband was living a double life with a second family in the city.
Established sections (stay consistent with them, reuse their names and facts, but do not repeat them):
{"identity":{"title":"The Second Family","genres":["drama","mystery"],"subgenres":["family"],"centralPremise":"A small-town diner owner discovers her late husband was living a double life with a second family in the city.","narrativeConcept":"Each episode peels back a layer of the double life, forcing both families to reckon with who he really was.","toneAndAtmosphere":"Bittersweet, grounded, quietly tense.","targetAudience":"Adults who enjoy character-driven drama with mystery elements.","centralConflict":"The diner owner vs. the second family over the truth of the man they both lost."}}
Section guidance:
Write only the characters section. Include 2-3 major characters (at least 2) with distinct roles, wants, fears, contradictions, and relationships. Keep every profile concise: each list has at most 3 items, each item is under 250 characters, and background and development stay under 500 characters. Reuse established names, locations, and world rules; do not invent a replacement setting.
Generate the characters section for this new Story Bible. Return the requested section and no other section. Stay consistent with any sections already generated.

Required output contract:
Return only the characters section as one JSON object. Follow the section guidance above. Do not wrap it in "section" or "value" keys. Arrays of strings must contain plain strings, not objects. Every array item and every required text field must be non-empty.
Use exactly these keys and nesting; do not rename, replace, or omit any of them:
{"characters":[{"name":"","storyRole":"protagonist","roleDescription":"","physicalDescription":"","personality":"","background":"","motivations":[""],"fearsAndWeaknesses":[""],"abilitiesAndLimitations":[""],"relationships":[{"characterName":"","relationship":"","tensionOrChange":""}],"secrets":[""],"developmentPotential":""}],"relationshipDynamics":[""]}
"@

# --- JSON Schemas (from storyBibleTask.ts) ---
$IdentitySchema = @{
  type = "object"
  additionalProperties = $false
  properties = @{
    title = @{ type = "string"; minLength = 1; maxLength = 120 }
    genres = @{ type = "array"; items = @{ type = "string"; minLength = 1; maxLength = 80 }; minItems = 1; maxItems = 3 }
    subgenres = @{ type = "array"; items = @{ type = "string"; minLength = 1; maxLength = 400 }; maxItems = 4 }
    centralPremise = @{ type = "string"; minLength = 1; maxLength = 1500 }
    narrativeConcept = @{ type = "string"; minLength = 1; maxLength = 1200 }
    toneAndAtmosphere = @{ type = "string"; minLength = 1; maxLength = 600 }
    targetAudience = @{ type = "string"; minLength = 1; maxLength = 400 }
    centralConflict = @{ type = "string"; minLength = 1; maxLength = 800 }
  }
  required = @("title","genres","subgenres","centralPremise","narrativeConcept","toneAndAtmosphere","targetAudience","centralConflict")
}

$CharactersSchema = @{
  type = "object"
  additionalProperties = $false
  properties = @{
    characters = @{
      type = "array"
      minItems = 2
      maxItems = 3
      items = @{
        type = "object"
        additionalProperties = $false
        properties = @{
          name = @{ type = "string"; minLength = 1; maxLength = 80 }
          storyRole = @{ type = "string"; enum = @("protagonist","antagonist","supporting","recurring") }
          roleDescription = @{ type = "string"; minLength = 1; maxLength = 300 }
          physicalDescription = @{ type = "string"; maxLength = 400 }
          personality = @{ type = "string"; minLength = 1; maxLength = 400 }
          background = @{ type = "string"; minLength = 1; maxLength = 500 }
          motivations = @{ type = "array"; items = @{ type = "string"; minLength = 1; maxLength = 250 }; maxItems = 3 }
          fearsAndWeaknesses = @{ type = "array"; items = @{ type = "string"; minLength = 1; maxLength = 250 }; maxItems = 3 }
          abilitiesAndLimitations = @{ type = "array"; items = @{ type = "string"; minLength = 1; maxLength = 250 }; maxItems = 3 }
          relationships = @{
            type = "array"
            maxItems = 4
            items = @{
              type = "object"
              additionalProperties = $false
              properties = @{
                characterName = @{ type = "string"; minLength = 1; maxLength = 80 }
                relationship = @{ type = "string"; minLength = 1; maxLength = 250 }
                tensionOrChange = @{ type = "string"; minLength = 1; maxLength = 300 }
              }
              required = @("characterName","relationship","tensionOrChange")
            }
          }
          secrets = @{ type = "array"; items = @{ type = "string"; minLength = 1; maxLength = 250 }; maxItems = 2 }
          developmentPotential = @{ type = "string"; minLength = 1; maxLength = 400 }
        }
        required = @("name","storyRole","roleDescription","physicalDescription","personality","background","motivations","fearsAndWeaknesses","abilitiesAndLimitations","relationships","secrets","developmentPotential")
      }
    }
    relationshipDynamics = @{ type = "array"; items = @{ type = "string"; minLength = 1; maxLength = 400 }; maxItems = 4 }
  }
  required = @("characters","relationshipDynamics")
}

# --- Strip minLength/maxLength/maxItems/minItems from a schema tree ---
function StripLimits($obj) {
  if ($obj -is [System.Collections.IDictionary] -or $obj -is [hashtable]) {
    $clone = @{}
    foreach ($key in $obj.Keys) {
      if ($key -in @("minLength","maxLength","maxItems","minItems")) { continue }
      $clone[$key] = StripLimits $obj[$key]
    }
    return $clone
  }
  if ($obj -is [System.Collections.IList] -or $obj -is [array]) {
    return @($obj | ForEach-Object { StripLimits $_ })
  }
  return $obj
}

# --- Send a request to Ollama and return timing ---
function Send-OllamaRequest {
  param(
    [string]$Section,
    [string]$UserPrompt,
    $Format,           # $null = no format, "json" = plain JSON, hashtable = schema
    [int]$NumPredict
  )

  $payload = @{
    model = $Model
    messages = @(
      @{ role = "system"; content = $SystemPrompt }
      @{ role = "user"; content = $UserPrompt }
    )
    stream = $false
    options = @{
      temperature = $Temperature
      num_ctx = $NumCtx
      top_p = $TopP
      repeat_penalty = $RepeatPenalty
      repeat_last_n = $RepeatLastN
      num_predict = $NumPredict
    }
  }
  if ($null -ne $Format) {
    $payload.format = $Format
  }

  $jsonBody = $payload | ConvertTo-Json -Depth 20
  $response = Invoke-RestMethod -Uri "$BaseUrl/api/chat" -Method Post -Body $jsonBody -ContentType "application/json" -TimeoutSec 300

  $evalCount = $response.eval_count
  $promptEvalCount = $response.prompt_eval_count
  $loadDuration = $response.load_duration
  $promptEvalDuration = $response.prompt_eval_duration
  $evalDuration = $response.eval_duration
  $totalDuration = $response.total_duration
  $doneReason = $response.done_reason

  # durations from Ollama are in nanoseconds
  $loadMs = if ($loadDuration) { [math]::Round($loadDuration / 1e6, 1) } else { 0 }
  $promptEvalMs = if ($promptEvalDuration) { [math]::Round($promptEvalDuration / 1e6, 1) } else { 0 }
  $evalMs = if ($evalDuration) { [math]::Round($evalDuration / 1e6, 1) } else { 0 }
  $totalMs = if ($totalDuration) { [math]::Round($totalDuration / 1e6, 1) } else { 0 }

  $tokensPerSec = if ($evalMs -gt 0) { [math]::Round($evalCount / ($evalMs / 1000), 2) } else { 0 }

  return @{
    section = $Section
    evalCount = $evalCount
    promptEvalCount = $promptEvalCount
    loadMs = $loadMs
    promptEvalMs = $promptEvalMs
    evalMs = $evalMs
    totalMs = $totalMs
    tokensPerSec = $tokensPerSec
    doneReason = $doneReason
  }
}

# --- Run benchmarks ---
$Sections = @(
  @{ name = "identity"; prompt = $IdentityPrompt; schema = $IdentitySchema }
  @{ name = "characters"; prompt = $CharactersPrompt; schema = $CharactersSchema }
)

$Modes = @(
  @{ name = "no_format";     format = $null }
  @{ name = "full_schema";   format = "schema" }     # placeholder, replaced per-section
  @{ name = "stripped_schema"; format = "stripped" }  # placeholder
  @{ name = "json";          format = "json" }
)

$results = @()

Write-Host ""
Write-Host "Ollama Story Bible Section Benchmark"
Write-Host "===================================="
Write-Host "Model: $Model"
Write-Host "num_ctx: $NumCtx | temp: $Temperature | top_p: $TopP | repeat_penalty: $RepeatPenalty | repeat_last_n: $RepeatLastN"
Write-Host ""

foreach ($section in $Sections) {
  $sectionName = $section.name
  $numPredict = $SectionCaps[$sectionName]
  $fullSchema = $section.schema
  $strippedSchema = StripLimits $fullSchema

  Write-Host "--- Section: $sectionName (num_predict=$numPredict) ---"

  for ($run = 1; $run -le 2; $run++) {
    foreach ($mode in $Modes) {
      $modeName = $mode.name
      $formatValue = $null

      switch ($modeName) {
        "no_format"      { $formatValue = $null }
        "full_schema"    { $formatValue = $fullSchema }
        "stripped_schema" { $formatValue = $strippedSchema }
        "json"           { $formatValue = "json" }
      }

      $label = "  Run $run | $modeName"
      Write-Host -NoNewline "$label ... "

      try {
        $r = Send-OllamaRequest -Section $sectionName -UserPrompt $section.prompt -Format $formatValue -NumPredict $numPredict
        $r.mode = $modeName
        $r.run = $run
        $results += $r
        Write-Host ("eval={0} t/s={1} load={2}ms prompt_eval={3}ms eval={4}ms total={5}ms done={6}" -f `
          $r.evalCount, $r.tokensPerSec, $r.loadMs, $r.promptEvalMs, $r.evalMs, $r.totalMs, $r.doneReason)
      } catch {
        Write-Host "FAILED: $_"
        $results += @{ section = $sectionName; mode = $modeName; run = $run; error = "$_" }
      }
    }
    Write-Host ""
  }
}

# --- Summary table ---
Write-Host ""
Write-Host "Summary (avg of 2 runs)"
Write-Host "======================="
Write-Host ""
$header = "{0,-12} {1,-16} {2,8} {3,8} {4,10} {5,10} {6,10} {7,10}" -f `
  "Section", "Mode", "evalCnt", "t/s", "load(ms)", "pEval(ms)", "eval(ms)", "total(ms)"
Write-Host $header
Write-Host ("-" * $header.Length)

$grouped = $results | Where-Object { $_.error -eq $null } | Group-Object section, mode
foreach ($g in $grouped) {
  $avg = @{
    evalCount = ($g.Group | Measure-Object evalCount -Average).Average
    tokensPerSec = ($g.Group | Measure-Object tokensPerSec -Average).Average
    loadMs = ($g.Group | Measure-Object loadMs -Average).Average
    promptEvalMs = ($g.Group | Measure-Object promptEvalMs -Average).Average
    evalMs = ($g.Group | Measure-Object evalMs -Average).Average
    totalMs = ($g.Group | Measure-Object totalMs -Average).Average
  }
  $parts = $g.Name -split ", "
  Write-Host ("{0,-12} {1,-16} {2,8} {3,8} {4,10} {5,10} {6,10} {7,10}" -f `
    $parts[0], $parts[1], [math]::Round($avg.evalCount), [math]::Round($avg.tokensPerSec,1), `
    [math]::Round($avg.loadMs,0), [math]::Round($avg.promptEvalMs,0), [math]::Round($avg.evalMs,0), [math]::Round($avg.totalMs,0))
}

Write-Host ""
Write-Host "Done. $($results.Count) runs total."