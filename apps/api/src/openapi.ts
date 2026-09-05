/**
 * OpenAPI description of the CineMemory API. Served at /api/openapi.json so the API can be registered
 * as an OpenAPI tool for a Google Cloud Agent Builder / Gemini Enterprise agent (or any other agent
 * framework): an external agent can create projects, run the pipeline, read continuity status and
 * trigger repairs through these operations.
 */
export function openApiDocument(baseUrl: string) {
  const projectParam = { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Project id" };
  const job = { type: "object", properties: { id: { type: "string" }, projectId: { type: "string" }, kind: { type: "string" }, status: { type: "string", enum: ["running", "complete", "failed"] }, detail: { type: "string" }, error: { type: "string" } } };
  const stage = { type: "string", enum: ["source_analyzed", "adapted", "screenplay_written", "memory_built", "shots_planned", "narrative_verified", "media_generated", "visually_verified", "film_assembled"] };
  return {
    openapi: "3.0.3",
    info: { title: "CineMemory API", version: "0.1.0", description: "Memory & verification layer for agentic filmmaking. Structured world memory, screenplay/shot planning, continuity critics and autonomous repair." },
    servers: [{ url: baseUrl }],
    paths: {
      "/api/health": { get: { operationId: "getHealth", summary: "Runtime status: which LLM/media providers are live and whether development fixtures are in use.", responses: { "200": { description: "OK" } } } },
      "/api/projects": {
        get: { operationId: "listProjects", summary: "List projects with stage, counts and continuity summary.", responses: { "200": { description: "OK" } } },
        post: {
          operationId: "createProject",
          summary: "Create a project from source material and a production brief.",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["title", "mode", "source", "brief"], properties: { title: { type: "string" }, mode: { type: "string", enum: ["creator", "kids"] }, source: { type: "object", required: ["kind", "title", "text"], properties: { kind: { type: "string", enum: ["original", "public_domain", "licensed", "screenplay", "idea", "lesson"] }, title: { type: "string" }, author: { type: "string" }, text: { type: "string" }, rightsNote: { type: "string" } } }, brief: { type: "object", required: ["genre", "audience", "targetDurationSec", "visualStyle"], properties: { genre: { type: "string" }, audience: { type: "string" }, ageRange: { type: "string" }, targetDurationSec: { type: "integer" }, language: { type: "string" }, visualStyle: { type: "string" }, tone: { type: "string" }, format: { type: "string" }, adaptationInstructions: { type: "string" }, requiredFacts: { type: "array", items: { type: "string" } } } } } } } } },
          responses: { "201": { description: "Created" } },
        },
      },
      "/api/projects/demo": { post: { operationId: "createDemoProject", summary: "Create (or return) the bundled demo project.", responses: { "201": { description: "Created" } } } },
      "/api/projects/{id}": { get: { operationId: "getProject", summary: "Project dashboard summary.", parameters: [projectParam], responses: { "200": { description: "OK" } } }, delete: { operationId: "deleteProject", summary: "Delete a project and all its artifacts.", parameters: [projectParam], responses: { "200": { description: "OK" } } } },
      "/api/projects/{id}/run": { post: { operationId: "runPipeline", summary: "Run the agent pipeline up to a stage (resumable). Returns a job.", parameters: [projectParam], requestBody: { content: { "application/json": { schema: { type: "object", properties: { toStage: stage, force: { type: "boolean" } } } } } }, responses: { "202": { description: "Job started", content: { "application/json": { schema: job } } }, "409": { description: "A job is already running" } } } },
      "/api/projects/{id}/reset": { post: { operationId: "resetPipeline", summary: "Reset from a stage; downstream artifacts are discarded.", parameters: [projectParam], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["stage"], properties: { stage } } } } }, responses: { "200": { description: "OK" } } } },
      "/api/projects/{id}/verify": { post: { operationId: "runCritics", summary: "Re-run the continuity critics.", parameters: [projectParam], requestBody: { content: { "application/json": { schema: { type: "object", properties: { critics: { type: "array", items: { type: "string", enum: ["narrative", "source_fidelity", "visual"] } } } } } } }, responses: { "202": { description: "Job started" } } } },
      "/api/projects/{id}/job": { get: { operationId: "getJob", summary: "Current and recent jobs for the project.", parameters: [projectParam], responses: { "200": { description: "OK" } } } },
      "/api/projects/{id}/events": { get: { operationId: "listEvents", summary: "Workflow event log (real agent activity).", parameters: [projectParam, { name: "after", in: "query", schema: { type: "integer" } }], responses: { "200": { description: "OK" } } } },
      "/api/projects/{id}/world": { get: { operationId: "getWorldMemory", summary: "Canonical world state (characters, locations, props, events, knowledge facts, constraints).", parameters: [projectParam], responses: { "200": { description: "OK" } } } },
      "/api/projects/{id}/screenplay": { get: { operationId: "getScreenplay", summary: "Current screenplay with revision history.", parameters: [projectParam], responses: { "200": { description: "OK" } } } },
      "/api/projects/{id}/shots": { get: { operationId: "getShots", summary: "Shot plan with generation status and media.", parameters: [projectParam], responses: { "200": { description: "OK" } } } },
      "/api/projects/{id}/graph": { get: { operationId: "getCineGraph", summary: "CineGraph nodes and edges; optional focus node neighbourhood.", parameters: [projectParam, { name: "focus", in: "query", schema: { type: "string" } }, { name: "depth", in: "query", schema: { type: "integer" } }], responses: { "200": { description: "OK" } } } },
      "/api/projects/{id}/violations": { get: { operationId: "listViolations", summary: "All violations with status, evidence and repair attempts.", parameters: [projectParam], responses: { "200": { description: "OK" } } } },
      "/api/projects/{id}/continuity": { get: { operationId: "getContinuitySummary", summary: "Derived continuity scores (pass ÷ evaluated checks).", parameters: [projectParam], responses: { "200": { description: "OK" } } } },
      "/api/projects/{id}/violations/{vid}/repair": { post: { operationId: "repairViolation", summary: "Run the Repair Agent on one violation (bounded retries, escalates).", parameters: [projectParam, { name: "vid", in: "path", required: true, schema: { type: "string" } }], responses: { "202": { description: "Job started" } } } },
      "/api/projects/{id}/violations/{vid}/override": { post: { operationId: "overrideViolation", summary: "Manually accept a violation with a note.", parameters: [projectParam, { name: "vid", in: "path", required: true, schema: { type: "string" } }], requestBody: { content: { "application/json": { schema: { type: "object", properties: { note: { type: "string" } } } } } }, responses: { "200": { description: "OK" } } } },
      "/api/projects/{id}/shots/{shotId}/generate": { post: { operationId: "generateShot", summary: "(Re)generate one shot's media and re-run the Visual Critic.", parameters: [projectParam, { name: "shotId", in: "path", required: true, schema: { type: "string" } }], responses: { "202": { description: "Job started" } } } },
      "/api/projects/{id}/film": { get: { operationId: "getFilm", summary: "Assembled film manifest (segments, chapters, subtitles, verification summary).", parameters: [projectParam], responses: { "200": { description: "OK" } } } },
      "/api/projects/{id}/evaluate": { post: { operationId: "runEvaluation", summary: "Run the baseline-vs-CineMemory evaluation harness.", parameters: [projectParam], responses: { "202": { description: "Job started" } } } },
      "/api/projects/{id}/evaluations": { get: { operationId: "listEvaluations", summary: "Evaluation comparisons with metrics computed from records.", parameters: [projectParam], responses: { "200": { description: "OK" } } } },
    },
  };
}
