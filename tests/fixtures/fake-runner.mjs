let input = "";
for await (const chunk of process.stdin) input += chunk;
const packet = JSON.parse(input);
const intent = packet.request.intent;
if (intent === "bad-json") process.stdout.write("not json");
else if (intent === "string-result") process.stdout.write(JSON.stringify({ type: "result", result: JSON.stringify({ schema_version: "1.0" }) }));
else if (intent === "too-large") process.stdout.write("x".repeat(4096));
else if (intent === "provider-422") { process.stderr.write("HTTP 422 rejected"); process.exitCode = 1; }
else if (intent === "provider-529") { process.stderr.write("HTTP 529 overloaded"); process.exitCode = 1; }
else if (intent === "timeout") setTimeout(() => {}, 60_000);
else {
  const selection = packet.request.selection;
  if (packet.fixed_context.output_contract === "narralens.proposal_comparison_draft@1.0") {
    const total = selection.end_frame_exclusive - selection.start_frame;
    const strategies = ["chronology", "contrast", "evidence-led", "map-led", "quote-led", "metaphor-led"];
    const roles = ["anchor", "context", "evidence", "contrast", "transition", "conclusion"];
    const proposals = Array.from({ length: packet.request.proposal_count }, (_, option) => {
      const count = option + 1;
      const base = Math.floor(total / count);
      const durations = Array.from({ length: count }, (_unused, index) => index === count - 1 ? total - base * (count - 1) : base);
      return {
        option_key: `option_${option + 1}`,
        title: `测试方案 ${option + 1}`,
        strategy: { kind: strategies[option], rationale: `采用第 ${option + 1} 种叙事结构` },
        summary: `针对意图“${packet.request.intent}”的真实结构化候选`,
        segments: durations.map((duration_frames, index) => ({ segment_id: `segment_${option + 1}_${index + 1}`, duration_frames,
          role: roles[index % roles.length], intent: `第 ${index + 1} 段视觉意图`, asset_requirement_ids: [] })),
        assets_needed: [], source_refs: [], requires_materialization: true, renderable: false,
      };
    });
    process.stdout.write(JSON.stringify({ type: "result", structured_output: { schema_version: "1.0", kind: "narralens.proposal_comparison_draft", proposals },
      modelUsage: { "fake-model": {} }, total_cost_usd: 0.0123, duration_ms: 42, num_turns: 1, service_tier: "test" }));
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({
    type: "result",
    structured_output: {
      schema_version: "1.0",
      kind: "narralens.proposal_bundle",
      project_id: packet.project.project_id,
      proposal_id: "proposal_test",
      base_revision: packet.request.base_revision,
      selection,
      preserve: packet.request.preserve,
      summary: "测试提案",
      segments: [{ id: "segment-1", duration_frames: selection.end_frame_exclusive - selection.start_frame, intent: packet.request.intent, asset_id: null }],
      assets_needed: [{ kind: "visual", reason: "待素材化" }],
      source_refs: [],
      cost: { status: "unknown", currency: null, amount: null },
      requires_materialization: true,
      renderable: false
    }
  }));
}
