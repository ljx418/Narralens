#!/usr/bin/env python3
"""Validate this DESIGN package, never the Narralens application or business Gates."""
from __future__ import annotations
import json, re, sys
from pathlib import Path

def main() -> int:
    root = Path(__file__).resolve().parents[1]
    checks: list[str] = []
    def load(p: str): return json.loads((root / p).read_text(encoding='utf-8'))
    try:
        from jsonschema import Draft202012Validator, FormatChecker
    except ImportError:
        print('Missing jsonschema. Install tools/requirements.txt in an isolated environment. No business tests have run.',file=sys.stderr)
        return 2
    schema=load('contracts/migration-contracts.schema.json')
    Draft202012Validator.check_schema(schema)
    v=Draft202012Validator(schema,format_checker=FormatChecker())
    for p in sorted((root/'examples').glob('*.json')):
        v.validate(json.loads(p.read_text(encoding='utf-8')))
        checks.append('Schema: '+p.name)
    matrix=load('templates/acceptance-matrix.json')['cases']
    ids=[x['id'] for x in matrix]
    assert len(ids)==len(set(ids)), 'Duplicate case IDs'
    assert all(x['status']=='NOT_RUN' for x in matrix), 'Plan must not contain business PASS'
    checks.append(f'Unique planned case IDs: {len(ids)}; all NOT_RUN')
    stages=load('templates/stage-registry.json')['stages']; by={x['id']:x for x in stages}
    seen=set(); active=set()
    def visit(s: str) -> None:
        assert s in by, f'Unknown stage {s}'
        assert s not in active, 'Stage dependency cycle'
        if s in seen:return
        active.add(s)
        for d in by[s]['deps']:visit(d)
        active.remove(s);seen.add(s)
    for s in by:visit(s)
    assert all(x['gate'] in by for x in matrix), 'Unknown Gate on case'
    checks.append(f'Acyclic stage graph: {len(stages)} stages')
    trace=load('templates/traceability-map.json')
    assert len(trace['p0'])==13 and len(trace['nfr'])==6 and len(trace['p1'])==4
    for x in trace['p0']:
        for s in x['new_gate'].split(','):
            assert s in by or s in ('M5A','M5B','M4A','M4B'), f'Unknown mapped stage/ticket {s}'
        for c in re.findall(r'[A-Z]+-\d{2}',x['cases']):assert c in ids, f'Unknown case {c}'
    checks.append('Traceability: 13 P0, 6 NFR, 4 P1 Gates')
    m=load('examples/materialized-proposal.json');segs=m['segments'];r=m['selection']
    assert segs[0]['range']['start_frame']==r['start_frame']
    assert segs[-1]['range']['end_frame']==r['end_frame']
    assert all(a['range']['end_frame']==b['range']['start_frame'] for a,b in zip(segs,segs[1:]))
    assert sum(s['range']['end_frame']-s['range']['start_frame'] for s in segs)==168
    assert all(s['source_frame_count']==56 for s in segs)
    checks.append('Illustrative segmentation: 168=56+56+56; not a media render')
    docs=load('docs-registry.json')
    for d in docs:
        assert (root/'docs'/f"{d['id']}.md").is_file()
        assert (root/'html'/f"{d['id']}.html").is_file()
    checks.append(f'Document pairs: {len(docs)} Markdown + HTML')
    readiness=load('templates/readiness.json')
    assert readiness['business_test_results']=='NOT_RUN' and not readiness['local_repository_reviewed']
    checks.append('Readiness is explicit: no local source review or business acceptance')
    print('\n'.join('OK  '+x for x in checks))
    print(f'PACKAGE_ONLY_PASS ({len(checks)} checks). No application Gate was evaluated.')
    return 0
if __name__=='__main__':
    try:raise SystemExit(main())
    except (AssertionError,ValueError,KeyError,FileNotFoundError) as exc:
        print('PACKAGE_VALIDATION_FAILED: '+str(exc),file=sys.stderr);raise SystemExit(1)
