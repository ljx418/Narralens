#!/usr/bin/env python3
"""Read-only verification of a LOCAL execution evidence manifest, not proof of product quality.
Usage: python tools/validate_evidence.py path/to/manifest.json --root path/to/evidence-root
Exit 0: required references/hashes/review metadata complete, NOT independent review approval.
Exit 1: invalid/incomplete. Exit 2: evidence explicitly not ready.
"""
from __future__ import annotations
import argparse, hashlib, json, re, sys
from pathlib import Path

def main() -> int:
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('manifest',type=Path);ap.add_argument('--root',type=Path,required=True)
    args=ap.parse_args();root=args.root.resolve();pkg=Path(__file__).resolve().parents[1]
    data=json.loads(args.manifest.read_text(encoding='utf-8'))
    from jsonschema import Draft202012Validator
    schema=json.loads((pkg/'contracts/migration-contracts.schema.json').read_text())
    Draft202012Validator(schema).validate(data)
    if data['kind']!='evidence_manifest':raise ValueError('Not an evidence manifest')
    if data['status']!='PASSED':
        print('NOT_READY: manifest status='+data['status']+'. No Gate is closed.');return 2
    fullsha=lambda s:bool(isinstance(s,str) and re.fullmatch(r'[0-9a-f]{40}',s))
    if not fullsha(data['repo_sha']):raise ValueError('Full repository SHA required')
    if data['stage'] not in ('M0','M1A') and not fullsha(data['engine_sha']):raise ValueError('Pinned engine SHA required')
    expected={c['id'] for c in json.loads((pkg/'templates/acceptance-matrix.json').read_text())['cases'] if c['gate']==data['stage']}
    actual={c['case_id']:c for c in data['cases']}
    if len(actual)!=len(data['cases']):raise ValueError('Duplicate case records')
    if not expected:raise ValueError('No automatic evidence rule for this Gate; add a reviewed matrix first')
    if expected-actual.keys():raise ValueError('Missing case IDs: '+', '.join(sorted(expected-actual.keys())))
    paths=set()
    for a in data['artifacts']:
        raw=Path(a['path'])
        if raw.is_absolute():raise ValueError('Artifact path must be relative')
        p=(root/raw).resolve()
        if not p.is_relative_to(root):raise ValueError('Artifact escapes evidence root')
        if not p.is_file():raise ValueError('Artifact missing: '+a['path'])
        h=hashlib.sha256()
        with p.open('rb') as f:
            for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
        if h.hexdigest()!=a['sha256']:raise ValueError('Artifact SHA mismatch: '+a['path'])
        paths.add(a['path'])
    for cid in expected:
        c=actual[cid]
        if c['status']!='PASSED' or c['exit_code']!=0 or not c['command'] or not c['local_test_ref'] or not c['artifact_paths']:
            raise ValueError('Incomplete passing evidence: '+cid)
        if not set(c['artifact_paths'])<=paths:raise ValueError('Unhashed artifact reference: '+cid)
    r=data['review']
    if r['decision']!='GO' or not r['independent_reviewer'] or r['reviewed_repo_sha']!=data['repo_sha'] or r['report_path'] not in paths:
        raise ValueError('Independent review metadata/report missing or wrong SHA')
    h=data['human_review'];need_human=data['stage'] in ('M5','M6','M7D') or h['required']
    if need_human and (not h['accepted'] or not h['reviewer'] or h['report_path'] not in paths):raise ValueError('Human review record missing')
    print('EVIDENCE_STRUCTURE_COMPLETE: references and SHA verified. This tool does not judge media quality, reviewer independence, or the complete local frozen matrix.');return 0
if __name__=='__main__':
    try:raise SystemExit(main())
    except Exception as exc:
        print('EVIDENCE_INVALID: '+str(exc),file=sys.stderr);raise SystemExit(1)
