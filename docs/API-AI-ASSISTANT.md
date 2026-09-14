# AI Marketing Assistant — Backend Notes

**For the backend agent.** This feature was implemented directly in the backend repo
(`D:\Projects\BackEnd\Marketing_backend`) by the frontend side. **Please review it rather than rebuild
it**, keep the contract below stable, and answer §8.

Status: backend builds, `GeminiAiServiceTests` (13) and `RouteTableTests` pass. **Not yet exercised
against a running API or a real Gemini key.**

---

## 1. What it does

A user types a prompt, the API sends it to Gemini, and the answer comes back as plain text.
MVP only: no history, conversation memory, RAG, campaign generation or billing.

```
Angular  →  POST /api/v1/ai/generate  →  IAiService (GeminiAiService)  →  Gemini generateContent
```

The browser never sees the provider or its key.

## 2. Files added / changed in the backend

| File | Change |
| --- | --- |
| `Marketing.Application/Interfaces/IAiService.cs` | **New.** `bool IsConfigured`, `Task<string> GenerateAsync(string prompt, CancellationToken)` |
| `Marketing.Application/DTOs/Ai/AiDtos.cs` | **New.** `AiGenerateRequest(string Prompt)` with `MaxPromptLength = 4000`; `AiGenerateResponse(string Answer)` |
| `Marketing.Application/Validators/AiGenerateRequestValidator.cs` | **New.** Required and not blank, ≤ 4000 chars. Picked up by the global `FluentValidationActionFilter` |
| `Marketing.Infrastructure/Ai/GeminiOptions.cs` | **New.** `ApiKey`, `Model`, `TimeoutSeconds` (5–120), `MaxOutputTokens` (256–8192) |
| `Marketing.Infrastructure/Ai/GeminiAiService.cs` | **New.** Typed `HttpClient` implementation |
| `Marketing.API/Controllers/AiController.cs` | **New.** `POST api/v{version}/ai/generate` |
| `Marketing.Common/Constants/Permissions.cs` | Added `Permissions.Ai.AssistantUse = "ai.assistant.use"`, included in `All` |
| `Marketing.Common/Constants/AppConstants.cs` | Added `RateLimits.AiGenerate = "rl:ai-generate"` |
| `Marketing.API/Extensions/RateLimitingExtensions.cs` | Policy: fixed window, **10 requests per minute per user**, no queue |
| `Marketing.Infrastructure/Extensions/InfrastructureServiceCollectionExtensions.cs` | Options bound with `ValidateDataAnnotations().ValidateOnStart()`; `GEMINI_API_KEY` fallback via `PostConfigure`; `AddHttpClient<IAiService, GeminiAiService>` with `Timeout = InfiniteTimeSpan` |
| `Marketing.API/appsettings.json` | New `Gemini` section. **`ApiKey` is empty and must stay empty** |
| `tests/Marketing.UnitTests/Services/GeminiAiServiceTests.cs` | **New.** 13 tests |

No NuGet packages were added. No migration is needed: the permission is a constant, and
`DatabaseSeeder.SeedRolesAsync` reconciles it into the Admin role on startup.

## 3. Endpoint contract (frontend depends on this)

`POST /api/v1/ai/generate`

```json
{ "prompt": "Create a promotional message for a dental clinic offering 20% off." }
```

200, with the standard envelope:

```json
{ "data": { "answer": "..." }, "message": null, "traceId": "..." }
```

Gates, in order:

1. `[Authorize]`
2. `[RequireModule(PlanModules.Ai)]`: the plan must include `ai`
3. `[RequirePermission(Permissions.Ai.AssistantUse)]`
4. `[EnableRateLimiting(RateLimits.AiGenerate)]`
5. Validator (422 before any provider call)

It accepts `?adminId=` for Super Admin "View as", using `ITenantScopeResolver.EnterAsync` like the other
controllers.

### Errors

The frontend branches on these, so **please keep the status codes and error codes**:

| Case | Status | errorCode | Exception |
| --- | --- | --- | --- |
| Empty or too-long prompt | 422 | `validation_failed` (`errors.Prompt`) | validator |
| No key configured | 409 | `ai_not_configured` | `BusinessRuleException` |
| Gemini withheld the answer (`promptFeedback.blockReason`, or empty text with finish `SAFETY`/`PROHIBITED_CONTENT`/`BLOCKLIST`/`SPII`/`RECITATION`) | 409 | `ai_response_blocked` | `BusinessRuleException` |
| Gemini 429 (free-tier quota) | 429 | `ai_rate_limited` | `RateLimitException` |
| Our own per-user limit | 429 | (rate limiter) | — |
| Gemini 5xx, timeout, network failure | 503 | `external_service_unavailable` | `ExternalServiceException(isTransient: true)` |
| Gemini 400/401/403/404 (bad key, restricted key, unknown model), malformed JSON, empty answer | 502 | `external_service_error` | `ExternalServiceException` |
| Caller disconnected | 499 | — | `OperationCanceledException` propagates |

`ExternalServiceException` isn't client-safe, so the response detail stays the generic "quote
reference" text. The frontend shows its own friendly message ("Unable to generate a response right
now. Please try again.").

## 4. Gemini implementation details

- **REST** `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- **Key location:** the key is sent in the `x-goog-api-key` header, never in the query string, so it
  can't appear in a logged URL.
- **Request body:** a short `systemInstruction` (a plain-text marketing assistant with WhatsApp-friendly
  length), a single user `contents` entry, and `generationConfig.maxOutputTokens`.
- **Response text:** the service joins `candidates[0].content.parts[].text` and skips parts marked
  `thought: true`, because newer models are thinking models.
- **Timeout:** `CancelAfter(TimeoutSeconds)` on a token linked to the caller's token. A timeout is then
  reported as 503, and a real caller cancellation stays a cancellation.
- **No retries, on purpose:** a retried generation spends quota twice. The client is **not** registered
  with the standard resilience handler.
- **Logging (EventIds 3701–3708):** model, status, Google's error `status` string (e.g.
  `INVALID_ARGUMENT`), elapsed ms, prompt and answer **lengths**, and finish reason. **The key and the
  prompt text are never logged.**
- **Why not the SDK:** the Google GenAI .NET SDK (`Google.GenAI`) was considered.
  `GooglePlacesProvider` already uses a typed `HttpClient` for Google, and one POST didn't justify a
  second pattern. Swapping to the SDK later only touches `GeminiAiService`.

## 5. Configuration and secrets

```json
"Gemini": {
  "ApiKey": "",
  "Model": "gemini-3.5-flash-lite",
  "TimeoutSeconds": 30,
  "MaxOutputTokens": 2048
}
```

The key comes from user secrets (`Gemini:ApiKey`), or the environment (`Gemini__ApiKey`, or
`GEMINI_API_KEY` as a fallback). An empty key is a supported state, like `Places:ApiKey`: the app
starts and the endpoint answers `ai_not_configured`.

**Never** put a key in `appsettings*.json`. Both a Gemini key and a Maps key were pasted into a chat
and are being rotated; don't copy any key value from anywhere into the repo.

`Places:ApiKey` has also been set in local user secrets, so business discovery should now work locally.

## 6. Permissions and plans

- `ai.assistant.use` is in `Permissions.All`.
  - **Admin** gets it through `ForRole` (everything except the platform-only permissions).
  - **Employee** does **not** get it by default, because each call spends quota. An Admin grants it
    through permission sets.
- The frontend catalogue (`permission.model.ts`) has a matching "AI Assistant" category with
  `module: 'ai'`.
- Existing sessions carry old JWT permission claims, so users must sign in again to see the tab.

## 7. Please verify once the API is running

1. **Swagger:** `POST /api/v1/ai/generate` appears with its request and response schemas.
2. **No key set:** the endpoint returns 409 `ai_not_configured` and logs warning 3701. The app still
   starts.
3. **Key set:** a normal prompt returns 200 with an answer, and log line 3708 contains no prompt text
   and no key.
4. **Invalid key:** the endpoint returns 502 and the response body contains no Gemini text.
5. **Rate limit:** the 11th call in a minute from one user returns 429.
6. **Employee without the permission:** 403. A plan without `ai`: the module-guard error.
7. **Admin role:** after startup, the Admin role in the database includes `ai.assistant.use`.

## 8. Questions for backend

1. **Plans:** which plans should include the `ai` module? Seeded plans may already enable it. Please
   confirm the production plan setup.
2. **Model:** is `gemini-3.5-flash-lite` acceptable as the default, and does its free-tier RPM
   actually allow 10/min per user? If the platform-wide free quota is the real limit, consider a
   global (not only per-user) limiter.
3. **Audit:** should generations be recorded (who, when, prompt length, never the text)? Nothing is
   stored today.
4. **Multi-instance:** the rate limiter is in-memory per instance, like the other policies. Is that
   acceptable for AI, or should it share Redis?
5. **Future providers:** if OpenAI, Azure OpenAI or Ollama are added, the plan is a `Ai:Provider`
   switch that picks the `IAiService` implementation. Please follow that shape rather than branching
   inside `GeminiAiService`.
