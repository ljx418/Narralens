import { useMemo, useState } from "react";
import type {
  LocalAssetCandidate,
  LocalAssetInventoryItem,
  LocalAssetLicenseStatus,
  LocalAssetRegistrationRequest,
  LocalAssetSourceKind,
} from "../agent-workbench-client.js";

/**
 * The controlled local-asset registration panel.
 *
 * The operator declares *what a candidate is*, and the Host decides what it becomes.
 * Three rules shape it:
 *
 * - **No path, no upload, no self-granted right.** The panel offers no file picker, no
 *   path field and no licence checkbox that pretends to be an approval. The candidate
 *   comes from the Host's own controlled list, and the declaration is a statement the
 *   operator makes about it.
 * - **The request carries the declaration and nothing else.** It carries the project,
 *   the candidate, the source, the licence and the recording origin — and no relative
 *   path, no expected digest and no attestation reference. Those belong to the Host.
 * - **The same id for the Agent.** The inventory that comes back is read by its own
 *   `asset_id`; the operator never copies an id or a JSON blob into a conversation.
 *
 * The runtime DTO and its validator belong to BRIDGE. The fields below mirror the
 * frozen asset metadata contract in `contracts/asset-import-metadata.schema.json`, and
 * the Host remains the authority on what it accepts.
 */

export type {
  LocalAssetCandidate,
  LocalAssetInventoryItem,
  LocalAssetLicense,
  LocalAssetLicenseStatus,
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
}

const SOURCE_LABEL: Readonly<Record<LocalAssetSourceKind, string>> = {
  owned: "自有",
  generated: "生成",
  licensed: "已授权",
};

const LICENSE_LABEL: Readonly<Record<LocalAssetLicenseStatus, string>> = {
  cleared: "已澄清",
  restricted: "有限制",
  unknown: "未知",
};

export function LocalAssetRegistrationPanel(props: LocalAssetRegistrationPanelProps) {
  const [candidateId, setCandidateId] = useState("");
  const [sourceKind, setSourceKind] = useState<LocalAssetSourceKind>("owned");
  const [sourceLabel, setSourceLabel] = useState("");
  const [licenseStatus, setLicenseStatus] = useState<LocalAssetLicenseStatus>("unknown");
  const [licenseLabel, setLicenseLabel] = useState("");
  const [commercialUse, setCommercialUse] = useState(false);
  const [recordingOrigin, setRecordingOrigin] = useState("");

  const selected = useMemo(
    () => props.candidates.find((candidate) => candidate.candidate_id === candidateId),
    [candidateId, props.candidates],
  );
  const ready = candidateId !== "" && sourceLabel.trim() !== "" && licenseLabel.trim() !== "" && recordingOrigin.trim() !== "";

  const register = (): void => {
    if (!ready || props.busy === true) return;
    void props.onRegister({
      project_id: props.projectId,
      candidate_id: candidateId,
      source: { kind: sourceKind, label: sourceLabel.trim() },
      license: { status: licenseStatus, label: licenseLabel.trim(), commercial_use: commercialUse },
      recording_origin: recordingOrigin.trim(),
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
              <span>{candidate.label}</span>
              {candidate.detail === undefined ? null : <small className="nl-muted">{candidate.detail}</small>}
            </label>
          ))}
        </fieldset>
      )}

      <div className="nl-local-assets-declaration">
        <label htmlFor="nl-local-asset-source-label">来源说明</label>
        <select
          id="nl-local-asset-source-kind"
          aria-label="来源类型"
          value={sourceKind}
          onChange={(event) => setSourceKind(event.target.value as LocalAssetSourceKind)}
        >
          {(Object.keys(SOURCE_LABEL) as LocalAssetSourceKind[]).map((kind) => (
            <option key={kind} value={kind}>{SOURCE_LABEL[kind]}</option>
          ))}
        </select>
        <input
          id="nl-local-asset-source-label"
          type="text"
          placeholder="例如：本机录音 / 已购素材库"
          value={sourceLabel}
          onChange={(event) => setSourceLabel(event.target.value)}
        />

        <label htmlFor="nl-local-asset-license-status">许可状态</label>
        <select
          id="nl-local-asset-license-status"
          aria-label="许可状态"
          value={licenseStatus}
          onChange={(event) => setLicenseStatus(event.target.value as LocalAssetLicenseStatus)}
        >
          {(Object.keys(LICENSE_LABEL) as LocalAssetLicenseStatus[]).map((status) => (
            <option key={status} value={status}>{LICENSE_LABEL[status]}</option>
          ))}
        </select>
        <input
          id="nl-local-asset-license-label"
          type="text"
          placeholder="许可说明（例如：仅限本项目使用）"
          value={licenseLabel}
          onChange={(event) => setLicenseLabel(event.target.value)}
        />
        <label className="nl-local-assets-commercial">
          <input
            type="checkbox"
            checked={commercialUse}
            onChange={(event) => setCommercialUse(event.target.checked)}
          />
          <span>可用于商业用途（由你声明，Host 会复核）</span>
        </label>

        <label htmlFor="nl-local-asset-recording-origin">录制来源</label>
        <input
          id="nl-local-asset-recording-origin"
          type="text"
          placeholder="例如：现场录音 / 屏幕录制 / 麦克风"
          value={recordingOrigin}
          onChange={(event) => setRecordingOrigin(event.target.value)}
        />
      </div>

      <button type="button" className="nl-primary" disabled={!ready || props.busy === true} onClick={register}>
        {props.busy === true ? "正在登记…" : "登记并声明此素材"}
      </button>
      <p className="nl-muted">
        登记只提交声明：不会上传文件、不会读取任意路径，也不会替你授予任何权利。
      </p>
      {selected === undefined ? null : (
        <p className="nl-muted" data-nl-local-asset-selected={selected.candidate_id}>
          已选择候选：{selected.label}
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
                <b>{item.label}</b>
                <span className="nl-muted"> {item.asset_id}</span>
                {item.source_label === undefined ? null : <small> 来源 {item.source_label}</small>}
                {item.license_label === undefined ? null : <small> 许可 {item.license_label}</small>}
                {item.recording_origin === undefined ? null : <small> 录制 {item.recording_origin}</small>}
                {item.eligible === false ? <small className="nl-local-assets-ineligible"> 当前不可用于制作</small> : null}
              </li>
            ))}
          </ul>
        )}
        <p className="nl-muted">Agent 读取的是同一份清单：你不需要复制任何编号。</p>
      </section>
    </section>
  );
}
