import { useMemo, useState } from "react";
import type {
  LocalAssetCandidate,
  LocalAssetInventoryItem,
  LocalAssetLicenseStatus,
  LocalAssetRecordingOrigin,
  LocalAssetRegistrationRequest,
  LocalAssetSourceKind,
} from "../agent-workbench-client.js";

/**
 * The controlled local-asset registration panel.
 *
 * The operator declares *what a candidate is*, and the Host decides what it becomes.
 * Four rules shape it:
 *
 * - **No path, no upload, no self-granted right.** The panel offers no file picker, no
 *   path field and no licence checkbox that pretends to be an approval. The candidate
 *   comes from the Host's own controlled list, and the declaration is a statement the
 *   operator makes about it.
 * - **The request carries the declaration and nothing else.** It carries the project,
 *   the candidate, the source, the licence and the recording origin — and no relative
 *   path, no expected digest, no attestation reference and no request key. Those belong
 *   to the Host and to the client that binds the key to this declaration.
 * - **Only the frozen values are offered.** The source kinds, the licence statuses and
 *   the recording origins are the reviewed enumerations; a free-text origin is not one
 *   of them and is never sent.
 * - **The same id for the Agent.** The inventory that comes back is read by its own
 *   `asset_id`; the operator never copies an id or a JSON blob into a conversation.
 *
 * The runtime DTO and its validator belong to BRIDGE. The fields below mirror the
 * reviewed adjunct schema `asset-inventory-v1`, and the Host remains the authority on
 * what it accepts.
 */

export type {
  LocalAssetCandidate,
  LocalAssetInventoryItem,
  LocalAssetLicense,
  LocalAssetLicenseStatus,
  LocalAssetRecordingOrigin,
  LocalAssetRegistrationRequest,
  LocalAssetSource,
  LocalAssetSourceKind,
} from "../agent-workbench-client.js";

export interface LocalAssetRegistrationPanelProps {
  /** The project the registration is for. */
  readonly projectId: string;
  /** The controlled candidates the Host offered. */
  readonly candidates: readonly LocalAssetCandidate[];
  /** The registered assets of this project. */
  readonly inventory: readonly LocalAssetInventoryItem[];
  /** Posts one declaration. The Host owns the outcome. */
  readonly onRegister: (request: LocalAssetRegistrationRequest) => void | Promise<void>;
  /** Re-reads the candidates and the inventory. */
  readonly onRefresh?: () => void;
  /** Whether a registration is in flight. */
  readonly busy?: boolean;
  /** The last failure, told truthfully. */
  readonly error?: string | null;
  /** The last outcome that is not a failure. */
  readonly notice?: string | null;
  /**
   * The request key of the last declaration, when there is one.
   *
   * It is shown so that an unknown result can be reconciled with the *same* key instead
   * of a new one.
   */
  readonly requestKey?: string | null;
}

const SOURCE_LABEL: Readonly<Record<LocalAssetSourceKind, string>> = {
  owned: "自有",
  generated: "生成",
  licensed: "已授权",
};

const DERIVED_LABEL = "由已有素材派生";

const LICENSE_LABEL: Readonly<Record<LocalAssetLicenseStatus, string>> = {
  cleared: "已澄清",
  restricted: "有限制",
  unknown: "未知",
};

const ORIGIN_LABEL: Readonly<Record<Exclude<LocalAssetRecordingOrigin, null>, string>> = {
  human_recording: "真人录制",
  synthetic: "合成生成",
  unknown: "来源不明",
};

/** The recording origins the reviewed schema allows. `null` is one of them. */
const ORIGIN_OPTIONS: readonly (LocalAssetRecordingOrigin)[] = [
  "human_recording", "synthetic", "unknown", null,
];

export function LocalAssetRegistrationPanel(props: LocalAssetRegistrationPanelProps) {
  const [candidateId, setCandidateId] = useState("");
  const [derived, setDerived] = useState(false);
  const [sourceKind, setSourceKind] = useState<LocalAssetSourceKind>("owned");
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceUri, setSourceUri] = useState("");
  const [lineage, setLineage] = useState("");
  const [licenseStatus, setLicenseStatus] = useState<LocalAssetLicenseStatus>("unknown");
  const [licenseLabel, setLicenseLabel] = useState("");
  const [commercialUse, setCommercialUse] = useState(false);
  const [recordingOrigin, setRecordingOrigin] = useState<LocalAssetRecordingOrigin>(null);

  const selected = useMemo(
    () => props.candidates.find((candidate) => candidate.candidate_id === candidateId),
    [candidateId, props.candidates],
  );
  const lineageIds = useMemo(
    () => lineage.split(/[,，、\s]+/u).map((part) => part.trim()).filter((part) => part !== ""),
    [lineage],
  );
  const ready = candidateId !== ""
    && sourceLabel.trim() !== ""
    && licenseLabel.trim() !== ""
    && (derived ? lineageIds.length > 0 : true);

  const register = (): void => {
    if (!ready || props.busy === true) return;
    void props.onRegister({
      project_id: props.projectId,
      candidate_id: candidateId,
      source: derived
        ? { kind: "derived", label: sourceLabel.trim(), lineage: lineageIds }
        : { kind: sourceKind, label: sourceLabel.trim(), uri: sourceUri.trim() === "" ? null : sourceUri.trim() },
      license: { status: licenseStatus, label: licenseLabel.trim(), commercial_use: commercialUse },
      recording_origin: recordingOrigin,
    });
  };

  return (
    <section className="nl-local-assets" aria-label="素材登记">
      <header className="nl-local-assets-head">
        <h3>素材登记</h3>
        {props.onRefresh === undefined ? null : (
          <button type="button" onClick={props.onRefresh} disabled={props.busy === true}>刷新候选与清单</button>
        )}
      </header>

      {props.error === null || props.error === undefined ? null : (
        <p className="nl-local-assets-error" role="alert">{props.error}</p>
      )}
      {props.notice === null || props.notice === undefined ? null : (
        <p className="nl-local-assets-notice" role="status" aria-live="polite">{props.notice}</p>
      )}
      {props.requestKey === null || props.requestKey === undefined || props.requestKey === "" ? null : (
        <p className="nl-muted" data-nl-local-asset-request-key={props.requestKey}>
          本次请求键 {props.requestKey}：结果未知时用同一个键对账，不要换键重发。
        </p>
      )}

      {props.candidates.length === 0 ? (
        <p className="nl-muted">当前没有受控候选：这里不会显示任何推测出来的素材。</p>
      ) : (
        <fieldset className="nl-local-assets-candidates">
          <legend>选择一个受控候选</legend>
          {props.candidates.map((candidate) => (
            <label key={candidate.candidate_id} className="nl-local-assets-candidate">
              <input
                type="radio"
                name="nl-local-asset-candidate"
                value={candidate.candidate_id}
                checked={candidateId === candidate.candidate_id}
                onChange={() => setCandidateId(candidate.candidate_id)}
              />
              <span>{candidate.display_name}</span>
              <small className="nl-muted">
                {" "}{candidate.kind} · {candidate.bytes} 字节 · 有效期至 {candidate.expires_at}
              </small>
            </label>
          ))}
        </fieldset>
      )}

      <div className="nl-local-assets-declaration">
        <label htmlFor="nl-local-asset-source-kind">来源类型</label>
        <select
          id="nl-local-asset-source-kind"
          value={derived ? "derived" : sourceKind}
          disabled={props.busy === true}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "derived") setDerived(true);
            else { setDerived(false); setSourceKind(value as LocalAssetSourceKind); }
          }}
        >
          {(Object.keys(SOURCE_LABEL) as LocalAssetSourceKind[]).map((kind) => (
            <option key={kind} value={kind}>{SOURCE_LABEL[kind]}</option>
          ))}
          <option value="derived">{DERIVED_LABEL}</option>
        </select>
        <label htmlFor="nl-local-asset-source-label">来源说明</label>
        <input
          id="nl-local-asset-source-label"
          type="text"
          placeholder="例如：本机录音 / 已购素材库"
          disabled={props.busy === true}
          value={sourceLabel}
          onChange={(event) => setSourceLabel(event.target.value)}
        />

        {derived ? (
          <>
            <label htmlFor="nl-local-asset-lineage">派生自（素材编号，逗号分隔）</label>
            <input
              id="nl-local-asset-lineage"
              type="text"
              placeholder="例如：asset_abc123"
              disabled={props.busy === true}
              value={lineage}
              onChange={(event) => setLineage(event.target.value)}
            />
          </>
        ) : (
          <>
            <label htmlFor="nl-local-asset-source-uri">来源地址（可留空）</label>
            <input
              id="nl-local-asset-source-uri"
              type="text"
              placeholder="例如：file:///… 或留空表示由 Host 解析"
                  disabled={props.busy === true}
              value={sourceUri}
              onChange={(event) => setSourceUri(event.target.value)}
            />
          </>
        )}

        <label htmlFor="nl-local-asset-license-status">许可状态</label>
        <select
          id="nl-local-asset-license-status"
          value={licenseStatus}
          disabled={props.busy === true}
          onChange={(event) => setLicenseStatus(event.target.value as LocalAssetLicenseStatus)}
        >
          {(Object.keys(LICENSE_LABEL) as LocalAssetLicenseStatus[]).map((status) => (
            <option key={status} value={status}>{LICENSE_LABEL[status]}</option>
          ))}
        </select>
        <label htmlFor="nl-local-asset-license-label">许可说明</label>
        <input
          id="nl-local-asset-license-label"
          type="text"
          placeholder="许可说明（例如：仅限本项目使用）"
          disabled={props.busy === true}
          value={licenseLabel}
          onChange={(event) => setLicenseLabel(event.target.value)}
        />
        <label className="nl-local-assets-commercial">
          <input
            type="checkbox"
            checked={commercialUse}
            disabled={props.busy === true}
            onChange={(event) => setCommercialUse(event.target.checked)}
          />
          <span>可用于商业用途（由你声明，Host 会复核）</span>
        </label>

        <label htmlFor="nl-local-asset-recording-origin">录制来源</label>
        <select
          id="nl-local-asset-recording-origin"
          value={recordingOrigin === null ? "" : recordingOrigin}
          disabled={props.busy === true}
          onChange={(event) => {
            const value = event.target.value;
            setRecordingOrigin(value === "" ? null : value as LocalAssetRecordingOrigin);
          }}
        >
          {ORIGIN_OPTIONS.map((origin) => (
            <option key={origin ?? "none"} value={origin ?? ""}>
              {origin === null ? "不声明" : ORIGIN_LABEL[origin]}
            </option>
          ))}
        </select>
      </div>

      <button type="button" className="nl-primary" disabled={!ready || props.busy === true} onClick={register}>
        {props.busy === true ? "正在登记…" : "登记并声明此素材"}
      </button>
      <p className="nl-muted">
        登记只提交声明：不会上传文件、不会读取任意路径，也不会替你授予任何权利。
      </p>
      {selected === undefined ? null : (
        <p className="nl-muted" data-nl-local-asset-selected={selected.candidate_id}>
          已选择候选：{selected.display_name}
        </p>
      )}

      <section className="nl-local-assets-inventory" aria-label="已登记素材">
        <h4>已登记素材</h4>
        {props.inventory.length === 0 ? (
          <p className="nl-muted">还没有登记任何素材。</p>
        ) : (
          <ul>
            {props.inventory.map((item) => (
              <li key={item.asset_id} data-nl-local-asset-id={item.asset_id}>
                <b>{item.asset_id}</b>
                <span className="nl-muted"> {item.media.kind} · {item.media.extension}</span>
                <small> 来源 {item.source_label}</small>
                <small> 许可 {item.license.label}</small>
                {item.license.status === "unknown" || item.license.status === "restricted" ? (
                  <small className="nl-local-assets-ineligible"> 许可状态：{LICENSE_LABEL[item.license.status]}</small>
                ) : null}
                <small>
                  {" "}录制 {item.recording_origin === null
                    ? "未声明"
                    : ORIGIN_LABEL[item.recording_origin]}
                </small>
              </li>
            ))}
          </ul>
        )}
        <p className="nl-muted">Agent 读取的是同一份清单：你不需要复制任何编号。</p>
      </section>
    </section>
  );
}
