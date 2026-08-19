import {
  type AtifStep,
  type AtifTrajectory,
  type PolicyCapabilities,
  type SharePolicy
} from "./contracts.ts"
import { validateTrajectory } from "./contracts.ts"

const CAPABILITIES: Readonly<Record<"internal" | SharePolicy, PolicyCapabilities>> = {
  internal: {
    policy: "internal",
    reasoning: true,
    task_content: true,
    tool_content: true,
    failure_details: true,
    all_traces: true
  },
  "partner-review": {
    policy: "partner-review",
    reasoning: true,
    task_content: true,
    tool_content: true,
    failure_details: false,
    all_traces: true
  },
  "lab-prospect": {
    policy: "lab-prospect",
    reasoning: false,
    task_content: false,
    tool_content: false,
    failure_details: false,
    all_traces: false
  }
}

export const policyCapabilities = (policy: "internal" | SharePolicy) => CAPABILITIES[policy]

const prospectStep = (step: AtifStep): AtifStep => ({
  step_id: step.step_id,
  ...(step.timestamp === undefined ? {} : { timestamp: step.timestamp }),
  source: step.source,
  ...(step.model_name === undefined ? {} : { model_name: step.model_name }),
  message: "Content withheld by lab-prospect policy.",
  ...(step.tool_calls === undefined
    ? {}
    : {
        tool_calls: step.tool_calls.map((call) => ({
          tool_call_id: call.tool_call_id,
          function_name: call.function_name,
          arguments: {},
          extra: { redacted: true }
        }))
      }),
  ...(step.observation === undefined
    ? {}
    : {
        observation: {
          results: step.observation.results.map((result) => ({
            ...(result.source_call_id === undefined ? {} : { source_call_id: result.source_call_id }),
            extra: { redacted: true }
          }))
        }
      }),
  ...(step.metrics === undefined ? {} : { metrics: step.metrics }),
  ...(step.llm_call_count === undefined ? {} : { llm_call_count: step.llm_call_count }),
  ...(step.is_copied_context === undefined ? {} : { is_copied_context: step.is_copied_context }),
  extra: { redacted: true }
})

export const redactTrace = (value: unknown, policy: SharePolicy): AtifTrajectory => {
  const trace = validateTrajectory(value)
  const metadata = trace.extra.clavia
  if (policy === "partner-review") {
    return {
      ...trace,
      ...(trace.subagent_trajectories === undefined
        ? {}
        : { subagent_trajectories: trace.subagent_trajectories.map((child) => redactTrace(child, policy)) }),
      extra: {
        ...trace.extra,
        clavia: {
          ...metadata,
          ...(metadata.failure_modes === undefined
            ? {}
            : {
                failure_modes: metadata.failure_modes.map((mode) => ({
                  id: mode.id,
                  verdict: mode.verdict
                }))
              })
        }
      }
    }
  }
  return {
    schema_version: trace.schema_version,
    ...(trace.session_id === undefined ? {} : { session_id: trace.session_id }),
    trajectory_id: trace.trajectory_id,
    agent: {
      name: trace.agent.name,
      version: trace.agent.version,
      ...(trace.agent.model_name === undefined ? {} : { model_name: trace.agent.model_name })
    },
    steps: trace.steps.map(prospectStep),
    ...(trace.notes === undefined ? {} : { notes: "Trace notes withheld by lab-prospect policy." }),
    ...(trace.final_metrics === undefined ? {} : { final_metrics: trace.final_metrics }),
    extra: {
      clavia: {
        schema_version: metadata.schema_version,
        title: metadata.title,
        source: metadata.source,
        ...(metadata.task === undefined
          ? {}
          : {
              task: {
                id: metadata.task.id,
                ...(metadata.task.work_type === undefined ? {} : { work_type: metadata.task.work_type })
              }
            }),
        outcome: metadata.outcome,
        behavior: metadata.behavior,
        ...(metadata.duration_ms === undefined ? {} : { duration_ms: metadata.duration_ms }),
        provider: { redacted: true }
      }
    }
  }
}
