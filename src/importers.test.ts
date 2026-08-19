import { describe, expect, test } from "bun:test"
import { convertBraintrust } from "./importers/braintrust.ts"
import { convertLangfuse } from "./importers/langfuse.ts"
import { convertLegalBenchCell } from "./importers/legalbench.ts"
import { convertOtel, convertTardigradeSpans } from "./importers/otel.ts"
import { behaviorOf } from "./importers/common.ts"

describe("open trace converters", () => {
  test("backports one Tardigrade LegalBench event log to ATIF", () => {
    const trace = convertLegalBenchCell({
      events: [
        { type: "MessageReceived", id: "run/model/08", text: "Draft a license clause.", at: 1000 },
        { type: "ModelCalled", callId: "run/model/08/infer/0", turn: "run/model/08", at: 1100 },
        {
          type: "ModelReturned",
          callId: "run/model/08/infer/0",
          usage: { promptTokens: 100, completionTokens: 20, costUsd: 0.01 },
          at: 1200
        },
        { type: "TextReturned", text: "I will write one clause.", at: 1200 },
        {
          type: "ToolCalled",
          callId: "write-1",
          name: "write",
          arguments: { file_path: "license.md", content: "License text" },
          at: 1201
        },
        { type: "ToolReturned", callId: "write-1", name: "write", result: "Wrote license.md", at: 1202 },
        { type: "ModelCalled", callId: "run/model/08/infer/1", turn: "run/model/08", at: 1300 },
        {
          type: "ModelReturned",
          callId: "run/model/08/infer/1",
          usage: { promptTokens: 140, completionTokens: 12, costUsd: 0.005 },
          at: 1400
        },
        { type: "TurnCompleted", output: "The draft is complete.", at: 1401 }
      ],
      providerTrace: [
        {
          key: "run/model/08/infer/0",
          effectiveModel: "alibaba/qwen3.7-max",
          finishReason: "tool_calls",
          latencyMs: 100,
          reasoning: "The user asked for a short license clause."
        },
        {
          key: "run/model/08/infer/1",
          effectiveModel: "alibaba/qwen3.7-max",
          finishReason: "stop",
          latencyMs: 100,
          reasoning: "The artifact is ready."
        }
      ],
      result: {
        agent_id: "legalbench-candidate/qwen-3-7-max/lab-v1",
        artifacts: [{ path: "license.md", bytes: 12, sha256: "abc" }],
        duration_ms: 401,
        model_slug: "qwen-3-7-max",
        requested_model_id: "alibaba/qwen3.7-max",
        run_id: "run",
        status: "completed",
        task_id: "08",
        work_type: "draft"
      },
      reliability: {
        judge: { model: "openai/gpt-5.6-sol" },
        result: {
          collection_alignment: { verdict: "ALIGNED" },
          results: [
            { id: "C-001", verdict: "PASS", justification: "The clause is focused." },
            { id: "C-002", verdict: "FAIL", justification: "One term is absent." }
          ],
          score: { passed: 1, total: 2 },
          strict_task_pass: false
        }
      },
      usefulness: [{ result: {
        clarity: { score: 3 },
        length: { score: 2 },
        structure: { score: 3 }
      } }]
    })
    expect(trace.schema_version).toBe("ATIF-v1.7")
    expect(trace.steps).toHaveLength(3)
    expect(trace.steps[1]?.tool_calls?.[0]?.function_name).toBe("write")
    expect(trace.final_metrics).toMatchObject({ total_prompt_tokens: 240, total_completion_tokens: 32 })
    expect(trace.extra.clavia.behavior.class).toBe("direct-builder")
    expect(trace.extra.clavia.failure_modes?.[1]?.verdict).toBe("FAIL")
  })

  test("converts OTLP GenAI spans grouped by trace ID", () => {
    const traces = convertOtel({ resourceSpans: [{ scopeSpans: [{ spans: [{
      traceId: "otel-trace",
      spanId: "span-1",
      name: "chat openai/gpt-5.6-sol",
      startTimeUnixNano: "1000000000",
      endTimeUnixNano: "2000000000",
      attributes: [
        { key: "gen_ai.operation.name", value: { stringValue: "chat" } },
        { key: "gen_ai.request.model", value: { stringValue: "openai/gpt-5.6-sol" } },
        { key: "gen_ai.input.messages", value: { stringValue: "[{\"role\":\"user\",\"content\":\"Hello\"}]" } },
        { key: "gen_ai.output.messages", value: { stringValue: "[{\"role\":\"assistant\",\"content\":\"Hi\"}]" } },
        { key: "gen_ai.usage.input_tokens", value: { intValue: "20" } },
        { key: "gen_ai.usage.output_tokens", value: { intValue: "4" } }
      ]
    }] }] }] })
    expect(traces).toHaveLength(1)
    expect(traces[0]?.steps.map((step) => step.source)).toEqual(["user", "agent"])
    expect(traces[0]?.final_metrics?.total_prompt_tokens).toBe(20)
  })

  test("converts Braintrust and Langfuse exports without service credentials", () => {
    const braintrust = convertBraintrust([
      {
        id: "bt-1",
        root_span_id: "bt-1",
        name: "answer",
        input: [{ role: "user", content: "Question" }],
        output: [{ role: "assistant", content: "Answer" }],
        metadata: { model: "openai/gpt-5.6-sol" },
        span_attributes: { type: "llm" },
        metrics: { prompt_tokens: 10, completion_tokens: 2 }
      }
    ])
    const langfuse = convertLangfuse([
      {
        id: "lf-1",
        trace_id: "trace-lf",
        type: "GENERATION",
        name: "answer",
        input: "Question",
        output: "Answer",
        model: "openai/gpt-5.6-sol",
        start_time: "2026-08-18 12:00:00.000000",
        end_time: "2026-08-18 12:00:01.000000",
        usage_details: { input: 10, output: 2 }
      }
    ])
    expect(braintrust[0]?.extra.clavia.source.kind).toBe("braintrust")
    expect(langfuse[0]?.extra.clavia.source.kind).toBe("langfuse")
    expect(langfuse[0]?.steps.map((step) => step.message)).toEqual(["Question", "Answer"])
  })

  test("preserves tool names from offline Tardigrade spans", () => {
    const traces = convertTardigradeSpans([
      {
        Timestamp: "2026-08-18T12:00:00.000Z",
        TraceId: "tardigrade-trace",
        SpanId: "root",
        ParentSpanId: "",
        SpanName: "legalbench.agent.turn",
        Duration: 2_000_000,
        StatusCode: "Ok",
        SpanAttributes: { "tardigrade.agent.name": "legalbench" },
        Links: []
      },
      {
        Timestamp: "2026-08-18T12:00:00.001Z",
        TraceId: "tardigrade-trace",
        SpanId: "tool",
        ParentSpanId: "root",
        SpanName: "transition.fire",
        Duration: 500_000,
        StatusCode: "Ok",
        SpanAttributes: {
          "gen_ai.operation.name": "execute_tool",
          "gen_ai.tool.name": "read",
          "gen_ai.tool.call.id": "call-1"
        },
        Links: []
      }
    ])
    expect(traces[0]?.agent.name).toBe("legalbench")
    expect(traces[0]?.steps[1]?.tool_calls?.[0]).toMatchObject({
      tool_call_id: "call-1",
      function_name: "read"
    })
    expect(traces[0]?.extra.clavia.duration_ms).toBe(2)
  })

  test("uses structured outcome status for recovery behavior", () => {
    const steps = [{
      step_id: 1,
      source: "agent" as const,
      message: "Review the returned error guidance.",
      tool_calls: [{ tool_call_id: "call-1", function_name: "read", arguments: {} }],
      observation: { results: [{ source_call_id: "call-1", content: "The source explains an error handling policy." }] }
    }]
    expect(behaviorOf(steps, "completed").class).toBe("answer-only")
    expect(behaviorOf(steps, "failed").class).toBe("recovery-loop")
  })
})
