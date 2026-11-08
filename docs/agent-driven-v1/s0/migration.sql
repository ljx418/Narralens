-- Target proposal: execute ONLY via MAIN migration in the existing RevisionStore DB.
-- Never run against a production DB as part of S0. No transaction authority replacement.
PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS ad_schema_migration (
 id TEXT PRIMARY KEY, contract_sha256 TEXT NOT NULL CHECK(length(contract_sha256)=64), applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ad_intake (
 intake_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, current_version INTEGER NOT NULL CHECK(current_version>=1), updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ad_intake_version (
 intake_id TEXT NOT NULL REFERENCES ad_intake(intake_id), version INTEGER NOT NULL CHECK(version>=1),
 brief_json TEXT NOT NULL CHECK(json_valid(brief_json)), brief_sha256 TEXT NOT NULL CHECK(length(brief_sha256)=64),
 created_at TEXT NOT NULL, PRIMARY KEY(intake_id,version)
);
CREATE TABLE IF NOT EXISTS ad_decision (
 decision_id TEXT PRIMARY KEY, intake_id TEXT NOT NULL, intake_version INTEGER NOT NULL,
 actor_id TEXT NOT NULL, channel TEXT NOT NULL CHECK(channel='trusted_ui'),
 brief_sha256 TEXT NOT NULL CHECK(length(brief_sha256)=64), choice TEXT NOT NULL CHECK(choice IN ('confirm_brief','reject_brief')),
 issued_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 FOREIGN KEY(intake_id,intake_version) REFERENCES ad_intake_version(intake_id,version)
);
CREATE TABLE IF NOT EXISTS ad_command (
 command_id TEXT PRIMARY KEY, principal_id TEXT NOT NULL, operation TEXT NOT NULL,
 idempotency_key TEXT NOT NULL, request_digest TEXT NOT NULL CHECK(length(request_digest)=64),
 reserved_project_id TEXT NOT NULL, job_id TEXT REFERENCES job(job_id),
 response_json TEXT CHECK(response_json IS NULL OR json_valid(response_json)), created_at TEXT NOT NULL,
 UNIQUE(principal_id,operation,idempotency_key)
);
CREATE TABLE IF NOT EXISTS ad_project_origin (
 project_id TEXT PRIMARY KEY REFERENCES project_state(project_id), origin TEXT NOT NULL CHECK(origin='created'),
 intake_id TEXT NOT NULL, intake_version INTEGER NOT NULL, decision_id TEXT NOT NULL REFERENCES ad_decision(decision_id),
 initial_snapshot_id TEXT NOT NULL REFERENCES snapshot(snapshot_id),
 creation_transaction_id TEXT NOT NULL REFERENCES project_transaction(transaction_id),
 descriptor_json TEXT NOT NULL CHECK(json_valid(descriptor_json)),
 FOREIGN KEY(intake_id,intake_version) REFERENCES ad_intake_version(intake_id,version)
);
CREATE TABLE IF NOT EXISTS ad_artifact_revision (
 project_id TEXT NOT NULL REFERENCES project_state(project_id), artifact_id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>=1), kind TEXT NOT NULL CHECK(kind IN ('script','storyboard')),
 input_digest TEXT NOT NULL CHECK(length(input_digest)=64), content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64),
 input_refs_json TEXT NOT NULL CHECK(json_valid(input_refs_json)), content_json TEXT NOT NULL CHECK(json_valid(content_json)), created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,artifact_id,version)
);
CREATE TABLE IF NOT EXISTS ad_workflow_node (
 project_id TEXT NOT NULL REFERENCES project_state(project_id), workflow_revision INTEGER NOT NULL CHECK(workflow_revision>=1),
 node_id TEXT NOT NULL, input_digest TEXT NOT NULL CHECK(length(input_digest)=64),
 job_id TEXT REFERENCES job(job_id), output_artifact_id TEXT, output_version INTEGER,
 PRIMARY KEY(project_id,workflow_revision,node_id),
 CHECK((output_artifact_id IS NULL)=(output_version IS NULL)),
 FOREIGN KEY(project_id,output_artifact_id,output_version) REFERENCES ad_artifact_revision(project_id,artifact_id,version)
);
CREATE TABLE IF NOT EXISTS ad_approval (
 approval_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project_state(project_id), impact_id TEXT NOT NULL,
 plan_sha256 TEXT NOT NULL CHECK(length(plan_sha256)=64), bound_facts_json TEXT NOT NULL CHECK(json_valid(bound_facts_json)),
 actor_id TEXT NOT NULL, channel TEXT NOT NULL CHECK(channel='trusted_ui'), expires_at TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('active','consumed','rejected','revoked')),
 consumed_transaction_id TEXT REFERENCES project_transaction(transaction_id),
 CHECK((state='consumed')=(consumed_transaction_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS ad_prepared_authorization (
 transaction_id TEXT PRIMARY KEY REFERENCES project_transaction(transaction_id),
 approval_id TEXT NOT NULL UNIQUE REFERENCES ad_approval(approval_id),
 facts_sha256 TEXT NOT NULL CHECK(length(facts_sha256)=64),
 facts_json TEXT NOT NULL CHECK(json_valid(facts_json))
);
CREATE TABLE IF NOT EXISTS ad_created_projection (
 project_id TEXT NOT NULL REFERENCES ad_project_origin(project_id), snapshot_id TEXT NOT NULL REFERENCES snapshot(snapshot_id),
 frame_count INTEGER NOT NULL CHECK(frame_count>=0), fps_num INTEGER NOT NULL CHECK(fps_num>0), fps_den INTEGER NOT NULL CHECK(fps_den>0),
 source_digest TEXT NOT NULL CHECK(length(source_digest)=64), PRIMARY KEY(project_id,snapshot_id)
);
CREATE TABLE IF NOT EXISTS ad_client_session (
 session_id TEXT PRIMARY KEY, principal_id TEXT NOT NULL, token_sha256 TEXT NOT NULL UNIQUE CHECK(length(token_sha256)=64),
 generation INTEGER NOT NULL CHECK(generation>=1), scopes_json TEXT NOT NULL CHECK(json_valid(scopes_json)),
 channel TEXT NOT NULL CHECK(channel IN ('mcp','trusted_ui')), expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ad_command_project ON ad_command(reserved_project_id);
CREATE INDEX IF NOT EXISTS ad_workflow_job ON ad_workflow_node(job_id);
CREATE INDEX IF NOT EXISTS ad_approval_project ON ad_approval(project_id,state);
CREATE TRIGGER IF NOT EXISTS ad_artifact_immutable BEFORE UPDATE ON ad_artifact_revision BEGIN SELECT RAISE(ABORT,'ARTIFACT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS ad_artifact_no_delete BEFORE DELETE ON ad_artifact_revision BEGIN SELECT RAISE(ABORT,'ARTIFACT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS ad_intake_version_immutable BEFORE UPDATE ON ad_intake_version BEGIN SELECT RAISE(ABORT,'INTAKE_VERSION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS ad_approval_monotonic BEFORE UPDATE OF state ON ad_approval
 WHEN NOT (OLD.state='active' AND NEW.state IN ('consumed','rejected','revoked')) AND NEW.state<>OLD.state
 BEGIN SELECT RAISE(ABORT,'APPROVAL_TERMINAL'); END;
CREATE TRIGGER IF NOT EXISTS ad_approval_facts_immutable BEFORE UPDATE ON ad_approval
 WHEN NEW.approval_id<>OLD.approval_id OR NEW.project_id<>OLD.project_id OR NEW.impact_id<>OLD.impact_id OR NEW.plan_sha256<>OLD.plan_sha256
 OR NEW.bound_facts_json<>OLD.bound_facts_json OR NEW.actor_id<>OLD.actor_id OR NEW.channel<>OLD.channel OR NEW.expires_at<>OLD.expires_at
 BEGIN SELECT RAISE(ABORT,'APPROVAL_FACTS_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS ad_approval_no_delete BEFORE DELETE ON ad_approval BEGIN SELECT RAISE(ABORT,'APPROVAL_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS ad_prepared_immutable BEFORE UPDATE ON ad_prepared_authorization BEGIN SELECT RAISE(ABORT,'PREPARED_AUTH_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS ad_prepared_no_delete BEFORE DELETE ON ad_prepared_authorization BEGIN SELECT RAISE(ABORT,'PREPARED_AUTH_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS ad_approval_terminal_immutable BEFORE UPDATE ON ad_approval WHEN OLD.state<>'active' BEGIN SELECT RAISE(ABORT,'APPROVAL_TERMINAL'); END;
CREATE TRIGGER IF NOT EXISTS ad_decision_immutable BEFORE UPDATE ON ad_decision BEGIN SELECT RAISE(ABORT,'DECISION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS ad_decision_no_delete BEFORE DELETE ON ad_decision BEGIN SELECT RAISE(ABORT,'DECISION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS ad_projection_immutable BEFORE UPDATE ON ad_created_projection BEGIN SELECT RAISE(ABORT,'PROJECTION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS ad_projection_no_delete BEFORE DELETE ON ad_created_projection BEGIN SELECT RAISE(ABORT,'PROJECTION_IMMUTABLE'); END;
COMMIT;
