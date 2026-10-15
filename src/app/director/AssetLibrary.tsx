import { useEffect, useRef, useState } from "react";

import type { AssetImportMetadata, AssetImportResponse, AssetInventoryResponse, AssetLicense } from "../../contracts/types.js";
import { HostApiClient, HostApiError } from "./api/HostApiClient.js";

type ImportStage = "idle" | "uploading" | "processing" | "success" | "cancelled" | "error";

const blockingLabels: Record<string, string> = {
  LICENSE_NOT_CLEARED: "许可尚未清除", COMMERCIAL_USE_NOT_ALLOWED: "未声明可商业使用",
  BYTES_UNAVAILABLE: "媒体文件不可用", HASH_MISMATCH: "媒体文件校验不一致", MEDIA_INVALID: "媒体格式或帧率不可用",
};

export function AssetLibrary({ api, projectId, onInventoryChanged }:
  { api: HostApiClient; projectId: string; onInventoryChanged: () => Promise<void> }): React.JSX.Element {
  const [inventory, setInventory] = useState<AssetInventoryResponse>();
  const [file, setFile] = useState<File>();
  const [sourceKind, setSourceKind] = useState<"owned" | "licensed" | "generated">("owned");
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceUri, setSourceUri] = useState("");
  const [licenseStatus, setLicenseStatus] = useState<AssetLicense["status"]>("cleared");
  const [licenseLabel, setLicenseLabel] = useState("");
  const [commercialUse, setCommercialUse] = useState(true);
  const [stage, setStage] = useState<ImportStage>("idle");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [result, setResult] = useState<AssetImportResponse>();
  const [resultFrames, setResultFrames] = useState<number>();
  const [retryKey, setRetryKey] = useState("");
  const controller = useRef<AbortController | undefined>(undefined);
  const errorSummary = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void api.assets(projectId).then((value) => { if (active) setInventory(value); })
      .catch((reason: unknown) => { if (active) setWarning(`库存读取失败：${formatError(reason)}`); });
    return () => { active = false; controller.current?.abort(); };
  }, [api, projectId]);

  const busy = stage === "uploading" || stage === "processing";
  const invalidateRetry = (): void => { setRetryKey(""); setResult(undefined); if (!busy) setStage("idle"); };
  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const validation = validateForm(file, sourceLabel, sourceUri, licenseStatus, licenseLabel, commercialUse);
    if (validation) { setError(validation); setStage("error"); queueMicrotask(() => errorSummary.current?.focus()); return; }
    const idempotencyKey = retryKey || `ui-asset-${crypto.randomUUID()}`;
    setRetryKey(idempotencyKey);
    const metadata: AssetImportMetadata = {
      idempotency_key: idempotencyKey,
      source: { kind: sourceKind, label: sourceLabel.trim(), ...(sourceUri.trim() ? { uri: sourceUri.trim() } : {}) },
      license: { status: licenseStatus, label: licenseLabel.trim(), commercial_use: commercialUse },
    };
    const nextController = new AbortController();
    controller.current = nextController;
    setError(""); setWarning(""); setResult(undefined); setStage("uploading");
    try {
      const imported = await api.importAsset(projectId, file!, metadata, {
        signal: nextController.signal,
        onUploadComplete: () => setStage((current) => current === "uploading" ? "processing" : current),
      });
      setResult(imported); setStage("success");
      try {
        const refreshed = await api.assets(projectId);
        setInventory(refreshed);
        setResultFrames(refreshed.assets.find((asset) => asset.asset_id === imported.asset_id)?.duration_frames);
      } catch (reason) { setWarning(`资产已登记，但库存刷新失败：${formatError(reason)}`); }
      try { await onInventoryChanged(); }
      catch (reason) { setWarning(`资产已登记，但可替换列表刷新失败：${formatError(reason)}`); }
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") { setStage("cancelled"); setError(""); }
      else { setStage("error"); setError(formatError(reason)); queueMicrotask(() => errorSummary.current?.focus()); }
    } finally { controller.current = undefined; }
  };

  return <section className="asset-library" aria-labelledby="asset-library-title">
    <div className="asset-library-intro">
      <span className="eyebrow">D4.2.1 · LOCAL ASSET REGISTRY</span><h2 id="asset-library-title">本地资产库存</h2>
      <p>登记本机 MP4 的来源与许可。成功仅表示资产已登记，未进入时间轴、未素材化、未采用。</p>
      <div className="manifest-fact"><span>清单格式</span><b>{inventory?.manifest_format ?? "读取中"}</b><code>{inventory?.manifest_sha256.slice(0, 16) ?? "—"}…</code></div>
    </div>
    <form className="asset-import" onSubmit={(event) => void submit(event)} noValidate>
      <fieldset disabled={busy}><legend>导入 MP4</legend>
        <label htmlFor="asset-file">本地 MP4 文件</label>
        <input id="asset-file" type="file" accept="video/mp4,.mp4" required aria-describedby="asset-file-help"
          onChange={(event) => { setFile(event.target.files?.[0]); invalidateRetry(); }} />
        <small id="asset-file-help">只上传文件内容；浏览器路径不会提交或登记。</small>
        {file && <p className="file-fact"><b>{file.name}</b><span>{formatBytes(file.size)}</span></p>}
        <div className="form-grid">
          <div><label htmlFor="source-kind">来源种类</label><select id="source-kind" value={sourceKind}
            onChange={(event) => { setSourceKind(event.target.value as typeof sourceKind); invalidateRetry(); }}>
            <option value="owned">自有</option><option value="licensed">授权</option><option value="generated">生成</option>
          </select></div>
          <div><label htmlFor="license-status">许可状态</label><select id="license-status" value={licenseStatus}
            onChange={(event) => { const value = event.target.value as AssetLicense["status"]; setLicenseStatus(value); if (value === "cleared") setCommercialUse(true); invalidateRetry(); }}>
            <option value="cleared">已清除</option><option value="restricted">受限</option><option value="unknown">未知</option>
          </select></div>
          <div><label htmlFor="source-label">来源标签</label><input id="source-label" value={sourceLabel} maxLength={2048} required
            onChange={(event) => { setSourceLabel(event.target.value); invalidateRetry(); }} /></div>
          <div><label htmlFor="license-label">许可标签</label><input id="license-label" value={licenseLabel} maxLength={2048} required
            onChange={(event) => { setLicenseLabel(event.target.value); invalidateRetry(); }} /></div>
        </div>
        <label htmlFor="source-uri">来源网址（可选，仅 HTTPS）</label>
        <input id="source-uri" type="url" inputMode="url" placeholder="https://example.com/source" value={sourceUri}
          aria-describedby="source-uri-help" onChange={(event) => { setSourceUri(event.target.value); invalidateRetry(); }} />
        <small id="source-uri-help">仅登记来源说明，Narralens 不会访问或下载该网址。</small>
        <label className="check"><input type="checkbox" checked={commercialUse} disabled={licenseStatus === "cleared"}
          onChange={(event) => { setCommercialUse(event.target.checked); invalidateRetry(); }} />允许商业使用</label>
      </fieldset>
      {error && <div className="form-error" role="alert" tabIndex={-1} ref={errorSummary}><b>导入未完成</b><span>{error}</span><small>表单和所选文件仍保留，可修正后重试。</small></div>}
      {warning && <div className="form-warning" role="status"><b>需要刷新</b><span>{warning}</span></div>}
      <div className="import-actions"><button className="primary" type="submit" disabled={busy}>{stage === "uploading" ? "上传中" : stage === "processing" ? "媒体校验与登记中" : "验证并登记资产"}</button>{busy && <button className="ghost" type="button" onClick={() => controller.current?.abort()}>取消本次导入</button>}</div>
      <div className="import-status" role="status" aria-live="polite">
        {stage === "uploading" && "正在流式上传；未显示未经测量的百分比。"}
        {stage === "processing" && "上传已完成，正在完整校验媒体并原子登记。"}
        {stage === "cancelled" && "已取消浏览器请求；若事务已开始，Host 会优先完成确定性登记。"}
        {stage === "success" && result && <><b>{result.created ? "资产已登记" : "资产已存在"}</b><span><code>{result.asset_id}</code>{resultFrames ? ` · ${resultFrames} 帧` : ""}</span><small>已登记，未进入时间轴。</small></>}
      </div>
    </form>
    <div className="inventory" role="region" aria-label="公开资产库存">
      <header><h3>全部登记资产</h3><span>{inventory ? `${inventory.assets.length} 项` : "读取中"}</span></header>
      {inventory?.assets.map((asset) => <article key={asset.asset_id} className={asset.eligible ? "eligible" : "blocked"}>
        <div><b>{asset.source.label}</b><code>{asset.asset_id}</code></div>
        <div className="asset-badges"><span>{asset.availability === "available" ? "文件可用" : "文件不可用"}</span><span>{asset.eligible ? "可采用" : "不可采用"}</span>{asset.source.kind === "generated" && <span>合成/生成画面</span>}</div>
        <dl><div><dt>帧数</dt><dd>{asset.duration_frames}</dd></div><div><dt>许可</dt><dd>{asset.license.label} · {licenseStatusLabel(asset.license.status)}</dd></div></dl>
        {!asset.eligible && <p>{asset.blocking_reasons.map((reason) => blockingLabels[reason] ?? reason).join("；")}</p>}
      </article>)}
      {inventory?.assets.length === 0 && <p className="empty">尚无登记资产。</p>}
    </div>
  </section>;
}

function validateForm(file: File | undefined, sourceLabel: string, sourceUri: string,
  status: AssetLicense["status"], licenseLabel: string, commercialUse: boolean): string {
  if (!file) return "请选择一个 MP4 文件。";
  if (!file.name.toLowerCase().endsWith(".mp4") && file.type !== "video/mp4") return "文件必须是 MP4。";
  if (!sourceLabel.trim()) return "请填写来源标签。";
  if (!licenseLabel.trim()) return "请填写许可标签。";
  if (sourceUri.trim() && !/^https:\/\/[^\s]+$/u.test(sourceUri.trim())) return "来源网址必须使用 HTTPS。";
  if (status === "cleared" && !commercialUse) return "许可已清除时必须声明允许商业使用。";
  return "";
}

function formatError(reason: unknown): string {
  if (reason instanceof HostApiError) {
    const guidance: Record<string, string> = {
      INVALID_MEDIA: "媒体不是可完整解码且与工程帧率一致的单视频流 MP4。",
      MEDIA_TOOL_UNAVAILABLE: "本机媒体校验工具不可用，请检查 ffprobe/ffmpeg。",
      PROJECT_ATTENTION_REQUIRED: "工程需要恢复处理，当前禁止继续写入。",
    };
    return `${reason.code} · ${guidance[reason.code] ?? reason.message}`;
  }
  return "本地服务不可用。";
}

function formatBytes(bytes: number): string { return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`; }
function licenseStatusLabel(status: AssetLicense["status"]): string { return status === "cleared" ? "已清除" : status === "restricted" ? "受限" : "未知"; }
