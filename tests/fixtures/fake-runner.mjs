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
