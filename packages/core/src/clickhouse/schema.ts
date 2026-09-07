/**
 * ClickHouse schema for CineMemory production memory.
 * Append-only tables; "current" views are obtained with ReplacingMergeTree + FINAL or version filters.
 * Every table is keyed by project_id first so per-production queries stay cheap.
 */
export function schemaStatements(db: string): string[] {
  const T = (name: string) => `${db}.${name}`;
  return [
    `CREATE DATABASE IF NOT EXISTS ${db}`,
    `CREATE TABLE IF NOT EXISTS ${T("events")} (
      project_id String, seq UInt64, ts DateTime64(3), agent LowCardinality(String), type LowCardinality(String),
      level LowCardinality(String), message String, data String
    ) ENGINE = ReplacingMergeTree ORDER BY (project_id, seq)`,
    `CREATE TABLE IF NOT EXISTS ${T("state_changes")} (
      project_id String, screenplay_version UInt32, change_id String, scene_id String, scene_number UInt32,
      entity_type LowCardinality(String), entity_id String, field LowCardinality(String), before String, after String,
      reason String, recorded_at DateTime64(3)
    ) ENGINE = ReplacingMergeTree(recorded_at) ORDER BY (project_id, screenplay_version, change_id)`,
    `CREATE TABLE IF NOT EXISTS ${T("knowledge_events")} (
      project_id String, screenplay_version UInt32, fact_id String, character_id String, scene_id String,
      scene_number UInt32, via String, statement String, recorded_at DateTime64(3)
    ) ENGINE = ReplacingMergeTree(recorded_at) ORDER BY (project_id, screenplay_version, fact_id, character_id)`,
    `CREATE TABLE IF NOT EXISTS ${T("scenes")} (
      project_id String, screenplay_version UInt32, scene_id String, number UInt32, act UInt32, title String,
      location_id String, time_of_day String, objective String, emotional_state String, character_ids Array(String),
      prop_ids Array(String), event_ids Array(String), duration_sec UInt32, line_count UInt32, lines String,
      recorded_at DateTime64(3)
    ) ENGINE = ReplacingMergeTree(recorded_at) ORDER BY (project_id, screenplay_version, number)`,
    `CREATE TABLE IF NOT EXISTS ${T("shots")} (
      project_id String, plan_version UInt32, shot_id String, scene_id String, scene_number UInt32, idx UInt32,
      duration_sec Float64, framing String, camera_movement String, character_ids Array(String), prop_ids Array(String),
      location_id String, time_of_day String, status LowCardinality(String), constraint_ids Array(String),
      prompt_hash String, keyframe_path String, keyframe_provider LowCardinality(String), generation_attempts UInt32,
      recorded_at DateTime64(3)
    ) ENGINE = ReplacingMergeTree(recorded_at) ORDER BY (project_id, shot_id)`,
    `CREATE TABLE IF NOT EXISTS ${T("constraints")} (
      project_id String, world_version UInt32, constraint_id String, family LowCardinality(String), kind LowCardinality(String),
      statement String, entity_ids Array(String), severity LowCardinality(String), recorded_at DateTime64(3)
    ) ENGINE = ReplacingMergeTree(recorded_at) ORDER BY (project_id, constraint_id)`,
    `CREATE TABLE IF NOT EXISTS ${T("entities")} (
      project_id String, world_version UInt32, entity_type LowCardinality(String), entity_id String, name String,
      description String, attributes String, recorded_at DateTime64(3)
    ) ENGINE = ReplacingMergeTree(recorded_at) ORDER BY (project_id, entity_type, entity_id)`,
    `CREATE TABLE IF NOT EXISTS ${T("violations")} (
      project_id String, violation_id String, fingerprint String, code LowCardinality(String), critic LowCardinality(String),
      constraint_id String, severity LowCardinality(String), confidence Float64, status LowCardinality(String),
      scene_id String, scene_number UInt32, shot_id String, line_index Int32, expected String, observed String,
      evidence String, repair_attempts UInt32, detected_at DateTime64(3), recorded_at DateTime64(3)
    ) ENGINE = ReplacingMergeTree(recorded_at) ORDER BY (project_id, violation_id)`,
    `CREATE TABLE IF NOT EXISTS ${T("violation_history")} (
      project_id String, violation_id String, code LowCardinality(String), critic LowCardinality(String),
      status LowCardinality(String), scene_id String, shot_id String, observed String, recorded_at DateTime64(3)
    ) ENGINE = MergeTree ORDER BY (project_id, violation_id, recorded_at)`,
    `CREATE TABLE IF NOT EXISTS ${T("checks")} (
      project_id String, run_id String, check_id String, critic LowCardinality(String), constraint_id String,
      code LowCardinality(String), outcome LowCardinality(String), description String, scene_id String, shot_id String,
      recorded_at DateTime64(3)
    ) ENGINE = MergeTree ORDER BY (project_id, run_id, check_id)`,
    `CREATE TABLE IF NOT EXISTS ${T("agent_actions")} (
      project_id String, action_id String, task LowCardinality(String), provider LowCardinality(String), model String,
      latency_ms UInt32, input_tokens UInt32, output_tokens UInt32, prompt_hash String, ok UInt8, error String,
      recorded_at DateTime64(3)
    ) ENGINE = MergeTree ORDER BY (project_id, recorded_at)`,
    `CREATE TABLE IF NOT EXISTS ${T("generation_attempts")} (
      project_id String, shot_id String, attempt UInt32, kind LowCardinality(String), provider LowCardinality(String),
      model String, path String, ok UInt8, error String, latency_ms UInt32, recorded_at DateTime64(3)
    ) ENGINE = MergeTree ORDER BY (project_id, shot_id, recorded_at)`,
    `CREATE TABLE IF NOT EXISTS ${T("repair_attempts")} (
      project_id String, violation_id String, attempt UInt32, root_cause LowCardinality(String), strategy String,
      target String, outcome LowCardinality(String), detail String, recorded_at DateTime64(3)
    ) ENGINE = MergeTree ORDER BY (project_id, violation_id, attempt)`,
    `CREATE TABLE IF NOT EXISTS ${T("evaluation_results")} (
      project_id String, comparison_id String, variant LowCardinality(String), eval_project_id String,
      constraints_evaluated UInt32, checks_evaluated UInt32, checks_not_evaluated UInt32, violations_detected UInt32,
      violations_repaired UInt32, violations_unresolved UInt32, visual_pass_rate Nullable(Float64),
      narrative_pass_rate Nullable(Float64), source_pass_rate Nullable(Float64), repair_attempts UInt32,
      recorded_at DateTime64(3)
    ) ENGINE = MergeTree ORDER BY (project_id, comparison_id, variant)`,
    `CREATE TABLE IF NOT EXISTS ${T("child_profiles")} (
      project_id String, child_id String, name String, age String, appearance String, outfit String,
      comfort_items Array(String), companions Array(String), places Array(String), must_not_show Array(String),
      sensory String, profile String, recorded_at DateTime64(3)
    ) ENGINE = ReplacingMergeTree(recorded_at) ORDER BY (child_id)`,
    `CREATE TABLE IF NOT EXISTS ${T("story_outcomes")} (
      project_id String, child_id String, outcome_id String, recorded_by String, times_watched UInt32,
      visit_outcome LowCardinality(String), notes String, anxious_steps Array(UInt32), step_notes String, recorded_at DateTime64(3)
    ) ENGINE = MergeTree ORDER BY (child_id, project_id, recorded_at)`,
  ];
}

export const MEMORY_TABLES = [
  "events",
  "entities",
  "constraints",
  "scenes",
  "state_changes",
  "knowledge_events",
  "shots",
  "violations",
  "violation_history",
  "checks",
  "agent_actions",
  "generation_attempts",
  "repair_attempts",
  "evaluation_results",
  "child_profiles",
  "story_outcomes",
] as const;
