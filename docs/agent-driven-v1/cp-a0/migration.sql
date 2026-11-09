-- CP-A0 candidate, docs only. Existing RevisionStore connection, after legacy upgrades.
-- Runner verifies supported base columns and exact schema fingerprint before/after.
PRAGMA foreign_keys=ON;
BEGIN IMMEDIATE;
CREATE UNIQUE INDEX IF NOT EXISTS cp_a0_snapshot_scope ON snapshot(project_id,snapshot_id);
CREATE UNIQUE INDEX IF NOT EXISTS cp_a0_transaction_scope ON project_transaction(project_id,transaction_id);
CREATE UNIQUE INDEX IF NOT EXISTS cp_a0_job_scope ON job(project_id,job_id);
CREATE UNIQUE INDEX IF NOT EXISTS cp_a0_outbox_scope ON outbox(project_id,event_id);
CREATE TABLE IF NOT EXISTS cp_a0_migration(id TEXT PRIMARY KEY CHECK(id='cp-a0-r4-candidate-1'), schema_version INTEGER NOT NULL CHECK(schema_version=1));
INSERT OR IGNORE INTO cp_a0_migration VALUES('cp-a0-r4-candidate-1',1);
CREATE TABLE IF NOT EXISTS cp_a0_intake_version(
 intake_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0), principal_id TEXT NOT NULL, input_digest TEXT NOT NULL CHECK(length(input_digest)=64),
 content_json TEXT NOT NULL CHECK(json_valid(content_json)), created_at TEXT NOT NULL, PRIMARY KEY(intake_id,version));
CREATE TABLE IF NOT EXISTS cp_a0_intake_head(intake_id TEXT PRIMARY KEY, current_version INTEGER NOT NULL, FOREIGN KEY(intake_id,current_version) REFERENCES cp_a0_intake_version(intake_id,version));
CREATE TABLE IF NOT EXISTS cp_a0_intake_content_decision(
 decision_id TEXT PRIMARY KEY, intake_id TEXT NOT NULL, intake_version INTEGER NOT NULL, request_id TEXT NOT NULL, input_digest TEXT NOT NULL CHECK(length(input_digest)=64),
 choice TEXT NOT NULL CHECK(choice IN('accept_content','revise_content','reject_content')), source TEXT NOT NULL CHECK(source IN('agent_conversation','driver_relay')),
 source_message_ref TEXT NOT NULL, authority TEXT NOT NULL CHECK(authority='content_only'), recorded_at TEXT NOT NULL,
 FOREIGN KEY(intake_id,intake_version) REFERENCES cp_a0_intake_version(intake_id,version));
CREATE UNIQUE INDEX IF NOT EXISTS cp_a0_intake_input_scope ON cp_a0_intake_version(intake_id,version,input_digest);
CREATE TABLE IF NOT EXISTS cp_a0_question_version(
 intake_id TEXT NOT NULL, intake_version INTEGER NOT NULL, input_digest TEXT NOT NULL,
 question_id TEXT NOT NULL, question_version INTEGER NOT NULL CHECK(question_version>0),
 kind TEXT NOT NULL CHECK(kind IN('text','choice')), skip_allowed INTEGER NOT NULL CHECK(skip_allowed IN(0,1)),
 question_json TEXT NOT NULL CHECK(json_valid(question_json)), created_at TEXT NOT NULL,
 PRIMARY KEY(intake_id,intake_version,question_id,question_version),
 FOREIGN KEY(intake_id,intake_version,input_digest) REFERENCES cp_a0_intake_version(intake_id,version,input_digest));
CREATE TABLE IF NOT EXISTS cp_a0_question_head(
 intake_id TEXT NOT NULL, intake_version INTEGER NOT NULL, question_id TEXT NOT NULL, current_question_version INTEGER NOT NULL,
 PRIMARY KEY(intake_id,intake_version,question_id),
 FOREIGN KEY(intake_id,intake_version,question_id,current_question_version) REFERENCES cp_a0_question_version(intake_id,intake_version,question_id,question_version));
CREATE TABLE IF NOT EXISTS cp_a0_answer_version(
 intake_id TEXT NOT NULL, intake_version INTEGER NOT NULL, question_id TEXT NOT NULL, question_version INTEGER NOT NULL,
 answer_id TEXT NOT NULL, answer_version INTEGER NOT NULL CHECK(answer_version>0), input_digest TEXT NOT NULL CHECK(length(input_digest)=64), principal_id TEXT NOT NULL,
 channel TEXT NOT NULL CHECK(channel IN('agent_conversation','driver_relay','trusted_ui')), authority TEXT NOT NULL CHECK(authority='content_only'),
 skipped INTEGER NOT NULL CHECK(skipped IN(0,1)), answer_json TEXT NOT NULL CHECK(json_valid(answer_json)), recorded_at TEXT NOT NULL,
 PRIMARY KEY(intake_id,intake_version,question_id,question_version,answer_version), UNIQUE(answer_id,answer_version),
 FOREIGN KEY(intake_id,intake_version,question_id,question_version) REFERENCES cp_a0_question_version(intake_id,intake_version,question_id,question_version));
CREATE TABLE IF NOT EXISTS cp_a0_answer_head(
 intake_id TEXT NOT NULL, intake_version INTEGER NOT NULL, question_id TEXT NOT NULL, question_version INTEGER NOT NULL, current_answer_version INTEGER NOT NULL,
 PRIMARY KEY(intake_id,intake_version,question_id,question_version),
 FOREIGN KEY(intake_id,intake_version,question_id,question_version,current_answer_version) REFERENCES cp_a0_answer_version(intake_id,intake_version,question_id,question_version,answer_version));
CREATE TRIGGER IF NOT EXISTS cp_a0_answer_input_guard BEFORE INSERT ON cp_a0_answer_version WHEN NOT EXISTS(
 SELECT 1 FROM cp_a0_question_version q WHERE q.intake_id=NEW.intake_id AND q.intake_version=NEW.intake_version AND q.question_id=NEW.question_id AND q.question_version=NEW.question_version AND q.input_digest=NEW.input_digest)
 BEGIN SELECT RAISE(ABORT,'ANSWER_INPUT_MISMATCH'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_answer_skip_guard BEFORE INSERT ON cp_a0_answer_version WHEN NEW.skipped=1 AND NOT EXISTS(
 SELECT 1 FROM cp_a0_question_version q WHERE q.intake_id=NEW.intake_id AND q.intake_version=NEW.intake_version AND q.question_id=NEW.question_id AND q.question_version=NEW.question_version AND q.skip_allowed=1)
 BEGIN SELECT RAISE(ABORT,'QUESTION_SKIP_NOT_ALLOWED'); END;
CREATE TABLE IF NOT EXISTS cp_a0_intake_confirmation(
 confirmation_id TEXT PRIMARY KEY, intake_id TEXT NOT NULL, intake_version INTEGER NOT NULL, input_digest TEXT NOT NULL CHECK(length(input_digest)=64),
 principal_id TEXT NOT NULL, channel TEXT NOT NULL CHECK(channel='trusted_ui'), session_ref TEXT NOT NULL, action TEXT NOT NULL CHECK(action='project.create'),
 issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL CHECK(expires_at>issued_at), FOREIGN KEY(intake_id,intake_version) REFERENCES cp_a0_intake_version(intake_id,version));
CREATE TABLE IF NOT EXISTS cp_a0_template_version(
 template_id TEXT NOT NULL CHECK(template_id='local-short-film'), version INTEGER NOT NULL CHECK(version=1), parent_version INTEGER,
 execution_digest TEXT NOT NULL CHECK(length(execution_digest)=64 AND execution_digest='b70615d5ad4246caac7d0e770022429de5826831b222447e4be7637e4a07ca32'),
 capability_id TEXT NOT NULL CHECK(capability_id IN('clip.prepare','snapshot.render','qc.inspect','delivery.package')), capability_version TEXT NOT NULL CHECK(capability_version='1'),
 definition_json TEXT NOT NULL CHECK(json_valid(definition_json)), created_at TEXT NOT NULL,
 PRIMARY KEY(template_id,version), FOREIGN KEY(template_id,parent_version) REFERENCES cp_a0_template_version(template_id,version), CHECK(parent_version IS NULL OR parent_version<version));
CREATE TABLE IF NOT EXISTS cp_a0_template_head(
 template_id TEXT PRIMARY KEY, draft_version INTEGER NOT NULL, published_version INTEGER,
 FOREIGN KEY(template_id,draft_version) REFERENCES cp_a0_template_version(template_id,version),
 FOREIGN KEY(template_id,published_version) REFERENCES cp_a0_template_version(template_id,version));
CREATE TABLE IF NOT EXISTS cp_a0_artifact_version(
 project_id TEXT NOT NULL REFERENCES project_state(project_id), artifact_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
 kind TEXT NOT NULL CHECK(kind IN('brief','script','storyboard','chapter','cover')), schema_version INTEGER NOT NULL CHECK(schema_version=1),
 input_digest TEXT NOT NULL CHECK(length(input_digest)=64), content_digest TEXT NOT NULL CHECK(length(content_digest)=64),
 content_json TEXT NOT NULL CHECK(json_valid(content_json)), input_refs_json TEXT NOT NULL CHECK(json_valid(input_refs_json)), created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,artifact_id,version));
CREATE TABLE IF NOT EXISTS cp_a0_artifact_head(
 project_id TEXT NOT NULL, artifact_id TEXT NOT NULL, draft_version INTEGER NOT NULL,
 PRIMARY KEY(project_id,artifact_id), FOREIGN KEY(project_id,artifact_id,draft_version) REFERENCES cp_a0_artifact_version(project_id,artifact_id,version));
CREATE TABLE IF NOT EXISTS cp_a0_run(
 project_id TEXT NOT NULL REFERENCES project_state(project_id), run_id TEXT NOT NULL, run_scope_digest TEXT NOT NULL CHECK(length(run_scope_digest)=64),
 template_id TEXT NOT NULL, template_version INTEGER NOT NULL, current_plan_version INTEGER NOT NULL CHECK(current_plan_version=1),
 state TEXT NOT NULL CHECK(state IN('ready','running','waiting_user','waiting_agent','waiting_resource','blocked','paused','reconciling','completed','failed','cancelled')),
 scope_json TEXT NOT NULL CHECK(json_valid(scope_json)), checkpoint_json TEXT NOT NULL CHECK(json_valid(checkpoint_json)), created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,run_id), UNIQUE(project_id,run_id,run_scope_digest),
 FOREIGN KEY(template_id,template_version) REFERENCES cp_a0_template_version(template_id,version));
CREATE TABLE IF NOT EXISTS cp_a0_plan_version(
 project_id TEXT NOT NULL, run_id TEXT NOT NULL, plan_version INTEGER NOT NULL CHECK(plan_version=1), run_scope_digest TEXT NOT NULL,
 input_digest TEXT NOT NULL CHECK(length(input_digest)=64), plan_json TEXT NOT NULL CHECK(json_valid(plan_json)), created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,run_id,plan_version), UNIQUE(project_id,run_id,plan_version,run_scope_digest),
 FOREIGN KEY(project_id,run_id,run_scope_digest) REFERENCES cp_a0_run(project_id,run_id,run_scope_digest));
CREATE TABLE IF NOT EXISTS cp_a0_review_request(
 project_id TEXT NOT NULL, run_id TEXT NOT NULL, plan_version INTEGER NOT NULL, run_scope_digest TEXT NOT NULL,
 review_id TEXT NOT NULL, gate TEXT NOT NULL CHECK(gate IN('brief','sample','first_chapter','chapter','cover','risk')),
 artifact_id TEXT NOT NULL, artifact_version INTEGER NOT NULL, input_digest TEXT NOT NULL CHECK(length(input_digest)=64),
 package_digest TEXT NOT NULL CHECK(length(package_digest)=64), state TEXT NOT NULL CHECK(state IN('pending','accepted','changes_requested','rejected','stale')),
 reuse_review_id TEXT, created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,run_id,review_id), UNIQUE(project_id,run_id,review_id,input_digest),
 FOREIGN KEY(project_id,run_id,plan_version,run_scope_digest) REFERENCES cp_a0_plan_version(project_id,run_id,plan_version,run_scope_digest),
 FOREIGN KEY(project_id,artifact_id,artifact_version) REFERENCES cp_a0_artifact_version(project_id,artifact_id,version),
 FOREIGN KEY(project_id,run_id,reuse_review_id) REFERENCES cp_a0_review_request(project_id,run_id,review_id));
CREATE TABLE IF NOT EXISTS cp_a0_content_decision(
 project_id TEXT NOT NULL, run_id TEXT NOT NULL, decision_id TEXT NOT NULL, review_id TEXT NOT NULL, input_digest TEXT NOT NULL,
 channel TEXT NOT NULL CHECK(channel IN('agent_conversation','driver_relay','trusted_ui')), actor_id TEXT NOT NULL,
 choice TEXT NOT NULL CHECK(choice IN('accepted','changes_requested','rejected')), source_ref TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,run_id,decision_id), FOREIGN KEY(project_id,run_id,review_id,input_digest) REFERENCES cp_a0_review_request(project_id,run_id,review_id,input_digest));
-- Separate trusted channel evidence; relay IDs cannot be used as confirmations by FK.
CREATE TABLE IF NOT EXISTS cp_a0_trusted_confirmation(
 project_id TEXT NOT NULL, run_id TEXT NOT NULL, confirmation_id TEXT NOT NULL, review_id TEXT, input_digest TEXT NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose IN('run.authorize','review','change.approve')),
 channel TEXT NOT NULL CHECK(channel='trusted_ui'), authenticated_actor TEXT NOT NULL, session_ref TEXT NOT NULL,
 action_digest TEXT NOT NULL CHECK(length(action_digest)=64), issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL CHECK(expires_at>issued_at),
 PRIMARY KEY(project_id,run_id,confirmation_id), CHECK(purpose='run.authorize' OR review_id IS NOT NULL), FOREIGN KEY(project_id,run_id,review_id,input_digest) REFERENCES cp_a0_review_request(project_id,run_id,review_id,input_digest));
CREATE TABLE IF NOT EXISTS cp_a0_execution_grant(
 project_id TEXT NOT NULL, run_id TEXT NOT NULL, grant_id TEXT NOT NULL, run_scope_digest TEXT NOT NULL, confirmation_id TEXT NOT NULL,
 principal_id TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN('clip.prepare','snapshot.render','qc.inspect','delivery.package','change.prepare','change.apply')), capability_id TEXT NOT NULL CHECK(capability_id IN('clip.prepare','snapshot.render','qc.inspect','delivery.package')),
 capability_version TEXT NOT NULL CHECK(capability_version='1'), allow_paid INTEGER NOT NULL CHECK(allow_paid=0), allow_external INTEGER NOT NULL CHECK(allow_external=0),
 state TEXT NOT NULL CHECK(state IN('active','revoked','expired')), expires_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,run_id,grant_id), UNIQUE(project_id,run_id,grant_id,run_scope_digest),
 FOREIGN KEY(project_id,run_id,run_scope_digest) REFERENCES cp_a0_run(project_id,run_id,run_scope_digest),
 FOREIGN KEY(project_id,run_id,confirmation_id) REFERENCES cp_a0_trusted_confirmation(project_id,run_id,confirmation_id));
CREATE TABLE IF NOT EXISTS cp_a0_step_attempt(
 project_id TEXT NOT NULL, run_id TEXT NOT NULL, plan_version INTEGER NOT NULL, run_scope_digest TEXT NOT NULL,
 step_id TEXT NOT NULL, attempt INTEGER NOT NULL CHECK(attempt>0), grant_id TEXT NOT NULL,
 input_digest TEXT NOT NULL CHECK(length(input_digest)=64), dependencies_json TEXT NOT NULL CHECK(json_valid(dependencies_json)),
 state TEXT NOT NULL CHECK(state IN('pending','running','waiting_user','succeeded','failed','cancelled','stale','unknown')),
 job_id TEXT, output_artifact_id TEXT, output_version INTEGER, updated_at TEXT NOT NULL,
 PRIMARY KEY(project_id,run_id,plan_version,step_id,attempt), UNIQUE(project_id,run_id,plan_version,step_id,attempt,input_digest), CHECK((output_artifact_id IS NULL)=(output_version IS NULL)),
 FOREIGN KEY(project_id,run_id,plan_version,run_scope_digest) REFERENCES cp_a0_plan_version(project_id,run_id,plan_version,run_scope_digest),
 FOREIGN KEY(project_id,run_id,grant_id,run_scope_digest) REFERENCES cp_a0_execution_grant(project_id,run_id,grant_id,run_scope_digest),
 FOREIGN KEY(project_id,job_id) REFERENCES job(project_id,job_id),
 FOREIGN KEY(project_id,output_artifact_id,output_version) REFERENCES cp_a0_artifact_version(project_id,artifact_id,version));
CREATE UNIQUE INDEX IF NOT EXISTS cp_a0_one_active_attempt ON cp_a0_step_attempt(project_id,run_id,plan_version,step_id) WHERE state IN('pending','running','waiting_user','unknown');
CREATE TABLE IF NOT EXISTS cp_a0_approval(
 project_id TEXT NOT NULL, run_id TEXT NOT NULL, approval_id TEXT NOT NULL, run_scope_digest TEXT NOT NULL, confirmation_id TEXT NOT NULL,
 plan_version INTEGER NOT NULL, step_id TEXT NOT NULL, attempt INTEGER NOT NULL, input_digest TEXT NOT NULL,
 change_id TEXT NOT NULL, impact_id TEXT NOT NULL, base_revision INTEGER NOT NULL CHECK(base_revision>=0), control_revision INTEGER NOT NULL CHECK(control_revision>=0),
 action_digest TEXT NOT NULL CHECK(length(action_digest)=64), facts_digest TEXT NOT NULL CHECK(length(facts_digest)=64),
 state TEXT NOT NULL CHECK(state IN('active','consumed','rejected','revoked')), expires_at INTEGER NOT NULL, consumed_transaction_id TEXT,
 PRIMARY KEY(project_id,run_id,approval_id), UNIQUE(consumed_transaction_id),
 CHECK((state='consumed')=(consumed_transaction_id IS NOT NULL)),
 FOREIGN KEY(project_id,run_id,run_scope_digest) REFERENCES cp_a0_run(project_id,run_id,run_scope_digest),
 FOREIGN KEY(project_id,run_id,confirmation_id) REFERENCES cp_a0_trusted_confirmation(project_id,run_id,confirmation_id),
 FOREIGN KEY(project_id,run_id,plan_version,step_id,attempt,input_digest) REFERENCES cp_a0_step_attempt(project_id,run_id,plan_version,step_id,attempt,input_digest),
 FOREIGN KEY(project_id,consumed_transaction_id) REFERENCES project_transaction(project_id,transaction_id));
CREATE TABLE IF NOT EXISTS cp_a0_prepared_authorization(
 project_id TEXT NOT NULL, run_id TEXT NOT NULL, transaction_id TEXT PRIMARY KEY, approval_id TEXT NOT NULL,
 facts_digest TEXT NOT NULL CHECK(length(facts_digest)=64), UNIQUE(project_id,run_id,approval_id),
 FOREIGN KEY(project_id,transaction_id) REFERENCES project_transaction(project_id,transaction_id),
 FOREIGN KEY(project_id,run_id,approval_id) REFERENCES cp_a0_approval(project_id,run_id,approval_id));
-- This is pre-project bootstrap reservation ONLY. Project commands use existing operation_idempotency.
CREATE TABLE IF NOT EXISTS cp_a0_bootstrap_command(
 command_id TEXT PRIMARY KEY, principal_id TEXT NOT NULL, operation TEXT NOT NULL CHECK(operation='project.create'), idempotency_key TEXT NOT NULL,
 request_digest TEXT NOT NULL CHECK(length(request_digest)=64), reserved_project_id TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL CHECK(state IN('reserved','staging','committed','compensating','failed')), response_json TEXT CHECK(response_json IS NULL OR json_valid(response_json)),
 UNIQUE(principal_id,operation,idempotency_key));
CREATE TABLE IF NOT EXISTS cp_a0_project_origin(
 project_id TEXT PRIMARY KEY REFERENCES project_state(project_id), origin TEXT NOT NULL CHECK(origin='created'), command_id TEXT NOT NULL UNIQUE REFERENCES cp_a0_bootstrap_command(command_id),
 intake_confirmation_id TEXT NOT NULL REFERENCES cp_a0_intake_confirmation(confirmation_id),
 intake_digest TEXT NOT NULL CHECK(length(intake_digest)=64), initial_snapshot_id TEXT NOT NULL, creation_transaction_id TEXT NOT NULL,
 root_ref TEXT NOT NULL CHECK(root_ref NOT LIKE '/%' AND instr(root_ref,'..')=0 AND instr(root_ref,':')=0),
 FOREIGN KEY(project_id,initial_snapshot_id) REFERENCES snapshot(project_id,snapshot_id), FOREIGN KEY(project_id,creation_transaction_id) REFERENCES project_transaction(project_id,transaction_id));
CREATE TABLE IF NOT EXISTS cp_a0_event(
 project_id TEXT NOT NULL, event_id INTEGER NOT NULL, run_id TEXT NOT NULL, run_scope_digest TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN('host','worker','native')), input_digest TEXT NOT NULL CHECK(length(input_digest)=64), observed_at TEXT NOT NULL,
 PRIMARY KEY(project_id,event_id), FOREIGN KEY(project_id,event_id) REFERENCES outbox(project_id,event_id),
 FOREIGN KEY(project_id,run_id,run_scope_digest) REFERENCES cp_a0_run(project_id,run_id,run_scope_digest));
CREATE TABLE IF NOT EXISTS cp_a0_native_ack(
 project_id TEXT NOT NULL, editor_session_id TEXT NOT NULL, ack_seq INTEGER NOT NULL CHECK(ack_seq>0),
 loaded_revision INTEGER NOT NULL CHECK(loaded_revision>=0), loaded_snapshot_id TEXT NOT NULL, source_digest TEXT NOT NULL CHECK(length(source_digest)=64), observed_at TEXT NOT NULL,
 PRIMARY KEY(project_id,editor_session_id,ack_seq), FOREIGN KEY(project_id,loaded_snapshot_id) REFERENCES snapshot(project_id,snapshot_id));
CREATE TABLE IF NOT EXISTS cp_a0_render_attempt(
 project_id TEXT NOT NULL, run_id TEXT NOT NULL, render_id TEXT NOT NULL, attempt INTEGER NOT NULL CHECK(attempt>0), run_scope_digest TEXT NOT NULL,
 snapshot_id TEXT NOT NULL, config_digest TEXT NOT NULL CHECK(length(config_digest)=64), config_json TEXT NOT NULL CHECK(json_valid(config_json)), job_id TEXT NOT NULL,
 staging_ref TEXT NOT NULL UNIQUE, state TEXT NOT NULL CHECK(state IN('requested','encoding','qc','publish_pending','ready','failed','cancelled','unknown')),
 encode_ok INTEGER NOT NULL CHECK(encode_ok IN(0,1)), probe_ok INTEGER NOT NULL CHECK(probe_ok IN(0,1)), decode_ok INTEGER NOT NULL CHECK(decode_ok IN(0,1)),
 qc TEXT NOT NULL CHECK(qc IN('pending','pass','warn','block')), sidecars_ok INTEGER NOT NULL CHECK(sidecars_ok IN(0,1)),
 PRIMARY KEY(project_id,run_id,render_id,attempt), UNIQUE(project_id,run_id,render_id,attempt,snapshot_id,config_digest),
 CHECK(state<>'ready' OR (encode_ok=1 AND probe_ok=1 AND decode_ok=1 AND sidecars_ok=1 AND qc IN('pass','warn'))),
 FOREIGN KEY(project_id,run_id,run_scope_digest) REFERENCES cp_a0_run(project_id,run_id,run_scope_digest),
 FOREIGN KEY(project_id,snapshot_id) REFERENCES snapshot(project_id,snapshot_id), FOREIGN KEY(project_id,job_id) REFERENCES job(project_id,job_id));
CREATE TABLE IF NOT EXISTS cp_a0_delivery(
 delivery_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, run_id TEXT NOT NULL, render_id TEXT NOT NULL, attempt INTEGER NOT NULL,
 snapshot_id TEXT NOT NULL, config_digest TEXT NOT NULL, manifest_digest TEXT NOT NULL CHECK(length(manifest_digest)=64),
 manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)), published_ref TEXT NOT NULL UNIQUE, event_id INTEGER NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(project_id,run_id,render_id,attempt),
 FOREIGN KEY(project_id,run_id,render_id,attempt,snapshot_id,config_digest) REFERENCES cp_a0_render_attempt(project_id,run_id,render_id,attempt,snapshot_id,config_digest),
 FOREIGN KEY(project_id,event_id) REFERENCES cp_a0_event(project_id,event_id));
CREATE TRIGGER IF NOT EXISTS cp_a0_delivery_ready BEFORE INSERT ON cp_a0_delivery WHEN NOT EXISTS(
 SELECT 1 FROM cp_a0_render_attempt r WHERE r.project_id=NEW.project_id AND r.run_id=NEW.run_id AND r.render_id=NEW.render_id AND r.attempt=NEW.attempt AND r.state='ready') BEGIN SELECT RAISE(ABORT,'DELIVERY_NOT_READY'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_origin_reserved BEFORE INSERT ON cp_a0_project_origin WHEN NOT EXISTS(SELECT 1 FROM cp_a0_bootstrap_command c WHERE c.command_id=NEW.command_id AND c.reserved_project_id=NEW.project_id) BEGIN SELECT RAISE(ABORT,'ORIGIN_SCOPE'); END;
CREATE INDEX IF NOT EXISTS cp_a0_run_state ON cp_a0_run(project_id,state);
CREATE INDEX IF NOT EXISTS cp_a0_review_pending ON cp_a0_review_request(project_id,run_id,state);
CREATE INDEX IF NOT EXISTS cp_a0_step_job ON cp_a0_step_attempt(project_id,job_id);
CREATE TRIGGER IF NOT EXISTS cp_a0_template_version_update BEFORE UPDATE ON cp_a0_template_version BEGIN SELECT RAISE(ABORT,'IMMUTABLE_TEMPLATE_VERSION'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_template_version_delete BEFORE DELETE ON cp_a0_template_version BEGIN SELECT RAISE(ABORT,'IMMUTABLE_TEMPLATE_VERSION'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_artifact_version_update BEFORE UPDATE ON cp_a0_artifact_version BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ARTIFACT_VERSION'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_artifact_version_delete BEFORE DELETE ON cp_a0_artifact_version BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ARTIFACT_VERSION'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_plan_version_update BEFORE UPDATE ON cp_a0_plan_version BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PLAN_VERSION'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_plan_version_delete BEFORE DELETE ON cp_a0_plan_version BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PLAN_VERSION'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_content_decision_update BEFORE UPDATE ON cp_a0_content_decision BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CONTENT_DECISION'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_content_decision_delete BEFORE DELETE ON cp_a0_content_decision BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CONTENT_DECISION'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_trusted_confirmation_update BEFORE UPDATE ON cp_a0_trusted_confirmation BEGIN SELECT RAISE(ABORT,'IMMUTABLE_TRUSTED_CONFIRMATION'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_trusted_confirmation_delete BEFORE DELETE ON cp_a0_trusted_confirmation BEGIN SELECT RAISE(ABORT,'IMMUTABLE_TRUSTED_CONFIRMATION'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_prepared_authorization_update BEFORE UPDATE ON cp_a0_prepared_authorization BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PREPARED_AUTHORIZATION'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_prepared_authorization_delete BEFORE DELETE ON cp_a0_prepared_authorization BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PREPARED_AUTHORIZATION'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_project_origin_update BEFORE UPDATE ON cp_a0_project_origin BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PROJECT_ORIGIN'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_project_origin_delete BEFORE DELETE ON cp_a0_project_origin BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PROJECT_ORIGIN'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_event_update BEFORE UPDATE ON cp_a0_event BEGIN SELECT RAISE(ABORT,'IMMUTABLE_EVENT'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_event_delete BEFORE DELETE ON cp_a0_event BEGIN SELECT RAISE(ABORT,'IMMUTABLE_EVENT'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_native_ack_update BEFORE UPDATE ON cp_a0_native_ack BEGIN SELECT RAISE(ABORT,'IMMUTABLE_NATIVE_ACK'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_native_ack_delete BEFORE DELETE ON cp_a0_native_ack BEGIN SELECT RAISE(ABORT,'IMMUTABLE_NATIVE_ACK'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_delivery_update BEFORE UPDATE ON cp_a0_delivery BEGIN SELECT RAISE(ABORT,'IMMUTABLE_DELIVERY'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_delivery_delete BEFORE DELETE ON cp_a0_delivery BEGIN SELECT RAISE(ABORT,'IMMUTABLE_DELIVERY'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_approval_update BEFORE UPDATE ON cp_a0_approval WHEN
 OLD.state<>'active' OR NEW.project_id<>OLD.project_id OR NEW.run_id<>OLD.run_id OR NEW.approval_id<>OLD.approval_id OR NEW.run_scope_digest<>OLD.run_scope_digest OR NEW.confirmation_id<>OLD.confirmation_id OR NEW.plan_version<>OLD.plan_version OR NEW.step_id<>OLD.step_id OR NEW.attempt<>OLD.attempt OR NEW.input_digest<>OLD.input_digest OR NEW.change_id<>OLD.change_id OR NEW.impact_id<>OLD.impact_id OR NEW.base_revision<>OLD.base_revision OR NEW.control_revision<>OLD.control_revision OR NEW.action_digest<>OLD.action_digest OR NEW.facts_digest<>OLD.facts_digest OR NEW.expires_at<>OLD.expires_at
 BEGIN SELECT RAISE(ABORT,'APPROVAL_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_approval_no_delete BEFORE DELETE ON cp_a0_approval BEGIN SELECT RAISE(ABORT,'APPROVAL_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_approval_consume BEFORE UPDATE ON cp_a0_approval WHEN NEW.state='consumed' AND NOT EXISTS(
 SELECT 1 FROM cp_a0_prepared_authorization p WHERE p.project_id=NEW.project_id AND p.run_id=NEW.run_id AND p.approval_id=NEW.approval_id AND p.transaction_id=NEW.consumed_transaction_id AND p.facts_digest=NEW.facts_digest)
 BEGIN SELECT RAISE(ABORT,'APPROVAL_PREPARED_MISMATCH'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_transaction_authorized BEFORE UPDATE OF state ON project_transaction WHEN NEW.state='committed' AND EXISTS(SELECT 1 FROM cp_a0_prepared_authorization p WHERE p.transaction_id=NEW.transaction_id) AND NOT EXISTS(
 SELECT 1 FROM cp_a0_prepared_authorization p JOIN cp_a0_approval a ON a.project_id=p.project_id AND a.run_id=p.run_id AND a.approval_id=p.approval_id WHERE p.transaction_id=NEW.transaction_id AND a.state='consumed' AND a.consumed_transaction_id=NEW.transaction_id)
 BEGIN SELECT RAISE(ABORT,'APPROVAL_NOT_CONSUMED'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_intake_version_update BEFORE UPDATE ON cp_a0_intake_version BEGIN SELECT RAISE(ABORT,'IMMUTABLE_INTAKE_VERSION'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_intake_version_delete BEFORE DELETE ON cp_a0_intake_version BEGIN SELECT RAISE(ABORT,'IMMUTABLE_INTAKE_VERSION'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_intake_content_decision_update BEFORE UPDATE ON cp_a0_intake_content_decision BEGIN SELECT RAISE(ABORT,'IMMUTABLE_INTAKE_CONTENT_DECISION'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_intake_content_decision_delete BEFORE DELETE ON cp_a0_intake_content_decision BEGIN SELECT RAISE(ABORT,'IMMUTABLE_INTAKE_CONTENT_DECISION'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_intake_confirmation_update BEFORE UPDATE ON cp_a0_intake_confirmation BEGIN SELECT RAISE(ABORT,'IMMUTABLE_INTAKE_CONFIRMATION'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_intake_confirmation_delete BEFORE DELETE ON cp_a0_intake_confirmation BEGIN SELECT RAISE(ABORT,'IMMUTABLE_INTAKE_CONFIRMATION'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_run_binding_immutable BEFORE UPDATE ON cp_a0_run WHEN NEW.project_id<>OLD.project_id OR NEW.run_id<>OLD.run_id OR NEW.run_scope_digest<>OLD.run_scope_digest OR NEW.scope_json<>OLD.scope_json OR NEW.template_id<>OLD.template_id OR NEW.template_version<>OLD.template_version OR NEW.current_plan_version<>OLD.current_plan_version BEGIN SELECT RAISE(ABORT,'RUN_BINDING_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_grant_binding_immutable BEFORE UPDATE ON cp_a0_execution_grant WHEN OLD.state<>'active' OR NEW.project_id<>OLD.project_id OR NEW.run_id<>OLD.run_id OR NEW.grant_id<>OLD.grant_id OR NEW.run_scope_digest<>OLD.run_scope_digest OR NEW.confirmation_id<>OLD.confirmation_id OR NEW.principal_id<>OLD.principal_id OR NEW.action<>OLD.action OR NEW.capability_id<>OLD.capability_id OR NEW.capability_version<>OLD.capability_version OR NEW.allow_paid<>OLD.allow_paid OR NEW.allow_external<>OLD.allow_external OR NEW.expires_at<>OLD.expires_at BEGIN SELECT RAISE(ABORT,'GRANT_BINDING_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_attempt_binding_immutable BEFORE UPDATE ON cp_a0_step_attempt WHEN OLD.state IN('succeeded','failed','cancelled','stale') OR NEW.project_id<>OLD.project_id OR NEW.run_id<>OLD.run_id OR NEW.plan_version<>OLD.plan_version OR NEW.run_scope_digest<>OLD.run_scope_digest OR NEW.step_id<>OLD.step_id OR NEW.attempt<>OLD.attempt OR NEW.grant_id<>OLD.grant_id OR NEW.input_digest<>OLD.input_digest OR NEW.dependencies_json<>OLD.dependencies_json BEGIN SELECT RAISE(ABORT,'ATTEMPT_BINDING_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_render_binding_immutable BEFORE UPDATE ON cp_a0_render_attempt WHEN OLD.state IN('ready','failed','cancelled') OR NEW.project_id<>OLD.project_id OR NEW.run_id<>OLD.run_id OR NEW.render_id<>OLD.render_id OR NEW.attempt<>OLD.attempt OR NEW.run_scope_digest<>OLD.run_scope_digest OR NEW.snapshot_id<>OLD.snapshot_id OR NEW.config_digest<>OLD.config_digest OR NEW.config_json<>OLD.config_json OR NEW.job_id<>OLD.job_id OR NEW.staging_ref<>OLD.staging_ref BEGIN SELECT RAISE(ABORT,'RENDER_BINDING_IMMUTABLE'); END;
-- A trusted interaction authorizes exactly its registered purpose and immutable digest.
CREATE TRIGGER IF NOT EXISTS cp_a0_grant_confirmation BEFORE INSERT ON cp_a0_execution_grant WHEN NOT EXISTS(
 SELECT 1 FROM cp_a0_trusted_confirmation t JOIN cp_a0_run r ON r.project_id=t.project_id AND r.run_id=t.run_id
 WHERE t.project_id=NEW.project_id AND t.run_id=NEW.run_id AND t.confirmation_id=NEW.confirmation_id
 AND t.purpose='run.authorize' AND t.authenticated_actor=NEW.principal_id
 AND t.action_digest=NEW.run_scope_digest AND r.run_scope_digest=NEW.run_scope_digest
 AND NEW.expires_at<=t.expires_at AND NEW.expires_at>t.issued_at)
 BEGIN SELECT RAISE(ABORT,'GRANT_CONFIRMATION_PURPOSE_ACTOR_SCOPE'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_approval_confirmation BEFORE INSERT ON cp_a0_approval WHEN NOT EXISTS(
 SELECT 1 FROM cp_a0_trusted_confirmation t WHERE t.project_id=NEW.project_id AND t.run_id=NEW.run_id AND t.confirmation_id=NEW.confirmation_id
 AND t.purpose='change.approve' AND t.input_digest=NEW.input_digest AND t.action_digest=NEW.action_digest
 AND NEW.expires_at<=t.expires_at AND NEW.expires_at>t.issued_at)
 BEGIN SELECT RAISE(ABORT,'APPROVAL_CONFIRMATION_PURPOSE_INPUT_ACTION'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_question_version_update BEFORE UPDATE ON cp_a0_question_version BEGIN SELECT RAISE(ABORT,'IMMUTABLE_QUESTION_VERSION'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_question_version_delete BEFORE DELETE ON cp_a0_question_version BEGIN SELECT RAISE(ABORT,'IMMUTABLE_QUESTION_VERSION'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_answer_version_update BEFORE UPDATE ON cp_a0_answer_version BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ANSWER_VERSION'); END;
CREATE TRIGGER IF NOT EXISTS cp_a0_answer_version_delete BEFORE DELETE ON cp_a0_answer_version BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ANSWER_VERSION'); END;
COMMIT;
