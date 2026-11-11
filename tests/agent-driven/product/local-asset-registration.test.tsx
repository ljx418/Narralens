// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LocalAssetRegistrationPanel } from "../../../src/app/observation/LocalAssetRegistrationPanel.js";
import type {
  LocalAssetCandidate,
  LocalAssetInventoryItem,
} from "../../../src/app/agent-workbench-client.js";

/**
 * The local-asset registration panel.
 *
 * These are component cases: they prove what the panel asks for and what it refuses to
 * ask for. They do not prove that a Host accepted a registration — that is BRIDGE's
 * producer, and it is not mounted here.
 *
 * The candidates and the inventory are in the reviewed `asset-inventory@1` shape: the
 * candidate is named by `display_name`, and the inventory item carries `source_label`
 * and a `license` object.
 */

afterEach(() => {
  cleanup();
});

const CANDIDATES: readonly LocalAssetCandidate[] = [
  {
    candidate_id: "cand-1",
    display_name: "麦克风录音 A",
    kind: "audio",
    bytes: 2048,
    expires_at: "2026-11-11T12:15:00.000Z",
  },
  {
    candidate_id: "cand-2",
    display_name: "屏幕录制 B",
    kind: "video",
    bytes: 4096,
    expires_at: "2026-11-11T12:15:00.000Z",
  },
];

const INVENTORY: readonly LocalAssetInventoryItem[] = [
  {
    asset_id: "asset_abc123",
    sha256: "a".repeat(64),
    bytes: 2048,
    registration_digest: "b".repeat(64),
    media: {
      kind: "audio",
      media_type: "audio/wav",
      extension: "wav",
      duration_frames: 0,
      duration_ms: 1000,
      width: null,
      height: null,
      sample_rate: 48000,
      channels: 1,
      codec: "pcm_s16le",
    },
    rights_ref: { id: "rights-1", version: 1, sha256: "c".repeat(64) },
    source_label: "本机录音",
    license: { status: "cleared", label: "仅限本项目使用", commercial_use: false },
    recording_origin: "human_recording",
  },
];

function renderPanel(overrides: Partial<Parameters<typeof LocalAssetRegistrationPanel>[0]> = {}) {
  const onRegister = vi.fn();
  render(
    <LocalAssetRegistrationPanel
      projectId="project-1"
      candidates={CANDIDATES}
      inventory={INVENTORY}
      onRegister={onRegister}
      {...overrides}
    />,
  );
  return { onRegister };
}

describe("the local asset registration panel", () => {
  it("offers only the controlled candidates and no path or upload control", () => {
    renderPanel();
    expect(screen.getByRole("radio", { name: /麦克风录音 A/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /屏幕录制 B/ })).toBeTruthy();
    // No file picker and no path field: the candidate comes from the Host.
    expect(document.querySelector('input[type="file"]')).toBeNull();
    for (const input of Array.from(document.querySelectorAll("input"))) {
      expect(input.getAttribute("type")).not.toBe("file");
    }
  });

  it("shows the candidate's own facts and not a made-up label", () => {
    renderPanel();
    const radio = screen.getByRole("radio", { name: /麦克风录音 A/ }) as HTMLInputElement;
    expect(radio.getAttribute("value")).toBe("cand-1");
    expect(radio.parentElement!.textContent).toContain("audio");
    expect(radio.parentElement!.textContent).toContain("2048");
  });

  it("shows no candidate at all when the Host has none", () => {
    renderPanel({ candidates: [] });
    expect(screen.queryByRole("radio", { name: /麦克风录音 A/ })).toBeNull();
    expect(screen.getByText(/当前没有受控候选/)).toBeTruthy();
  });

  it("will not register before the declaration is complete", () => {
    const { onRegister } = renderPanel();
    const submit = screen.getByRole("button", { name: "登记并声明此素材" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /麦克风录音 A/ }));
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("来源说明"), { target: { value: "本机录音" } });
    fireEvent.change(screen.getByLabelText("许可说明"), { target: { value: "仅限本项目" } });
    expect(submit.disabled).toBe(false);
    expect(onRegister).not.toHaveBeenCalled();
  });

  it("posts exactly the declaration and nothing else", () => {
    const { onRegister } = renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: /麦克风录音 A/ }));
    fireEvent.change(screen.getByLabelText("来源类型"), { target: { value: "owned" } });
    fireEvent.change(screen.getByLabelText("来源说明"), { target: { value: "本机录音" } });
    fireEvent.change(screen.getByLabelText("来源地址（可留空）"), { target: { value: "file:///a.wav" } });
    fireEvent.change(screen.getByLabelText("许可状态"), { target: { value: "cleared" } });
    fireEvent.change(screen.getByLabelText("许可说明"), { target: { value: "仅限本项目" } });
    fireEvent.change(screen.getByLabelText("录制来源"), { target: { value: "human_recording" } });
    fireEvent.click(screen.getByRole("button", { name: "登记并声明此素材" }));

    expect(onRegister).toHaveBeenCalledTimes(1);
    const request = onRegister.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(request).sort()).toEqual([
      "candidate_id", "license", "project_id", "recording_origin", "source",
    ]);
    expect(request.project_id).toBe("project-1");
    expect(request.candidate_id).toBe("cand-1");
    expect(request.source).toEqual({ kind: "owned", label: "本机录音", uri: "file:///a.wav" });
    expect(request.license).toEqual({ status: "cleared", label: "仅限本项目", commercial_use: false });
    expect(request.recording_origin).toBe("human_recording");
    // The Host owns the digest, the path and the attestation; the request key belongs
    // to the client that binds it to this declaration.
    expect(request).not.toHaveProperty("relative_path");
    expect(request).not.toHaveProperty("expected_sha256");
    expect(request).not.toHaveProperty("attestation_ref");
    expect(request).not.toHaveProperty("meta");
  });

  it("offers only the reviewed recording origins and never a free-text one", () => {
    renderPanel();
    const origin = screen.getByLabelText("录制来源") as HTMLSelectElement;
    const values = Array.from(origin.options).map((option) => option.value);
    expect(values).toEqual(["human_recording", "synthetic", "unknown", ""]);
    expect(origin.tagName).toBe("SELECT");
  });

  it("sends a null origin when the operator declines to declare one", () => {
    const { onRegister } = renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: /麦克风录音 A/ }));
    fireEvent.change(screen.getByLabelText("来源说明"), { target: { value: "本机录音" } });
    fireEvent.change(screen.getByLabelText("许可说明"), { target: { value: "仅限本项目" } });
    fireEvent.click(screen.getByRole("button", { name: "登记并声明此素材" }));
    const request = onRegister.mock.calls[0]![0] as { recording_origin: unknown };
    expect(request.recording_origin).toBeNull();
  });

  it("asks for the lineage of a derived source and sends it", () => {
    const { onRegister } = renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: /麦克风录音 A/ }));
    fireEvent.change(screen.getByLabelText("来源类型"), { target: { value: "derived" } });
    fireEvent.change(screen.getByLabelText("来源说明"), { target: { value: "由旁白派生" } });
    fireEvent.change(screen.getByLabelText("许可说明"), { target: { value: "仅限本项目" } });
    const submit = screen.getByRole("button", { name: "登记并声明此素材" }) as HTMLButtonElement;
    // Without a lineage the declaration is not complete.
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("派生自（素材编号，逗号分隔）"), { target: { value: "asset_abc123、asset_def456" } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    const request = onRegister.mock.calls[0]![0] as { source: unknown };
    expect(request.source).toEqual({ kind: "derived", label: "由旁白派生", lineage: ["asset_abc123", "asset_def456"] });
  });

  it("declares commercial use only when the operator says so", () => {
    const { onRegister } = renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: /麦克风录音 A/ }));
    fireEvent.change(screen.getByLabelText("来源说明"), { target: { value: "已购素材" } });
    fireEvent.change(screen.getByLabelText("许可说明"), { target: { value: "商用" } });
    fireEvent.click(screen.getByLabelText(/可用于商业用途/));
    fireEvent.click(screen.getByRole("button", { name: "登记并声明此素材" }));
    const request = onRegister.mock.calls[0]![0] as { license: { commercial_use: boolean } };
    expect(request.license.commercial_use).toBe(true);
  });

  it("shows the inventory by its own id and asks the operator for nothing", () => {
    renderPanel();
    const entry = document.querySelector("[data-nl-local-asset-id='asset_abc123']");
    expect(entry).not.toBeNull();
    expect(entry!.textContent).toContain("asset_abc123");
    expect(entry!.textContent).toContain("本机录音");
    expect(entry!.textContent).toContain("仅限本项目使用");
    // The operator never copies an id into a field: there is no such input.
    expect(document.querySelector("[data-nl-local-asset-id] input")).toBeNull();
  });

  it("marks an asset whose licence is not cleared", () => {
    renderPanel({
      inventory: [{
        ...INVENTORY[0]!,
        asset_id: "asset_xyz",
        license: { status: "restricted", label: "仅限本项目使用", commercial_use: false },
      }],
    });
    expect(document.querySelector("[data-nl-local-asset-id='asset_xyz']")!.textContent)
      .toContain("许可状态：有限制");
  });

  it("shows the request key so that an unknown result is reconciled with the same key", () => {
    renderPanel({ requestKey: "nl-1234" });
    expect(document.querySelector("[data-nl-local-asset-request-key='nl-1234']")).not.toBeNull();
  });

  it("shows the failure and the outcome as they are", () => {
    renderPanel({ error: "候选已过期，请刷新候选。", notice: "声明已登记：清单里有了 asset_abc123。" });
    expect(screen.getByRole("alert").textContent).toBe("候选已过期，请刷新候选。");
    expect(screen.getByRole("status").textContent).toContain("清单里有了 asset_abc123");
  });
});
