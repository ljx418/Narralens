// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LocalAssetRegistrationPanel } from "../../../src/app/observation/LocalAssetRegistrationPanel.js";

/**
 * The local-asset registration panel.
 *
 * These are component cases: they prove what the panel asks for and what it refuses to
 * ask for. They do not prove that a Host accepted a registration — that is BRIDGE's
 * producer, and it is not mounted here.
 */

afterEach(() => {
  cleanup();
});

const CANDIDATES = [
  { candidate_id: "cand-1", label: "麦克风录音 A" },
  { candidate_id: "cand-2", label: "屏幕录制 B", detail: "1920×1080" },
];

const INVENTORY = [
  {
    asset_id: "asset_abc123",
    label: "旁白 A",
    source_label: "本机录音",
    license_label: "仅限本项目使用",
    recording_origin: "麦克风",
    eligible: true,
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
    expect(screen.getByLabelText("麦克风录音 A")).toBeTruthy();
    // The second candidate carries a detail, so its label text is longer than its name.
    expect(screen.getByLabelText(/屏幕录制 B/)).toBeTruthy();
    // No file picker and no path field: the candidate comes from the Host.
    expect(document.querySelector('input[type="file"]')).toBeNull();
    for (const input of Array.from(document.querySelectorAll("input"))) {
      expect(input.getAttribute("type")).not.toBe("file");
      expect(input.getAttribute("placeholder") ?? "").not.toMatch(/路径|path/i);
    }
  });

  it("shows no candidate at all when the Host has none", () => {
    renderPanel({ candidates: [] });
    expect(screen.queryByLabelText("麦克风录音 A")).toBeNull();
    expect(screen.getByText(/当前没有受控候选/)).toBeTruthy();
  });

  it("will not register before the declaration is complete", () => {
    const { onRegister } = renderPanel();
    const submit = screen.getByRole("button", { name: "登记并声明此素材" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("麦克风录音 A"));
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("来源说明"), { target: { value: "本机录音" } });
    fireEvent.change(screen.getByPlaceholderText("许可说明（例如：仅限本项目使用）"), { target: { value: "仅限本项目" } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("录制来源"), { target: { value: "麦克风" } });
    expect(submit.disabled).toBe(false);
    expect(onRegister).not.toHaveBeenCalled();
  });

  it("posts exactly the declaration and nothing else", () => {
    const { onRegister } = renderPanel();
    fireEvent.click(screen.getByLabelText("麦克风录音 A"));
    fireEvent.change(screen.getByLabelText("来源类型"), { target: { value: "owned" } });
    fireEvent.change(screen.getByLabelText("来源说明"), { target: { value: "本机录音" } });
    fireEvent.change(screen.getByLabelText("许可状态"), { target: { value: "cleared" } });
    fireEvent.change(screen.getByPlaceholderText("许可说明（例如：仅限本项目使用）"), { target: { value: "仅限本项目" } });
    fireEvent.change(screen.getByLabelText("录制来源"), { target: { value: "麦克风" } });
    fireEvent.click(screen.getByRole("button", { name: "登记并声明此素材" }));

    expect(onRegister).toHaveBeenCalledTimes(1);
    const request = onRegister.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(request).sort()).toEqual([
      "candidate_id", "license", "project_id", "recording_origin", "source",
    ]);
    expect(request.project_id).toBe("project-1");
    expect(request.candidate_id).toBe("cand-1");
    expect(request.source).toEqual({ kind: "owned", label: "本机录音" });
    expect(request.license).toEqual({ status: "cleared", label: "仅限本项目", commercial_use: false });
    expect(request.recording_origin).toBe("麦克风");
    // The Host owns the digest, the path and the attestation.
    expect(request).not.toHaveProperty("relative_path");
    expect(request).not.toHaveProperty("expected_sha256");
    expect(request).not.toHaveProperty("attestation_ref");
  });

  it("declares commercial use only when the operator says so", () => {
    const { onRegister } = renderPanel();
    fireEvent.click(screen.getByLabelText("麦克风录音 A"));
    fireEvent.change(screen.getByLabelText("来源说明"), { target: { value: "已购素材" } });
    fireEvent.change(screen.getByPlaceholderText("许可说明（例如：仅限本项目使用）"), { target: { value: "商用" } });
    fireEvent.change(screen.getByLabelText("录制来源"), { target: { value: "导入" } });
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
    // The operator never copies an id into a field: there is no such input.
    expect(document.querySelector("[data-nl-local-asset-id] input")).toBeNull();
  });

  it("marks an asset that may not be used for production", () => {
    renderPanel({ inventory: [{ asset_id: "asset_xyz", label: "受限素材", eligible: false }] });
    expect(document.querySelector("[data-nl-local-asset-id='asset_xyz']")!.textContent)
      .toContain("当前不可用于制作");
  });

  it("shows the failure and the outcome as they are", () => {
    renderPanel({ error: "候选已过期，请刷新候选。", notice: "声明已提交：登记是否成功以清单为准。" });
    expect(screen.getByRole("alert").textContent).toBe("候选已过期，请刷新候选。");
    expect(screen.getByRole("status").textContent).toContain("以清单为准");
  });
});
