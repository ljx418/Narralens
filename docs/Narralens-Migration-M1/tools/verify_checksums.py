#!/usr/bin/env python3
"""Check distributed package files against SHA256SUMS.txt. Does not run business code."""
from pathlib import Path
import hashlib, sys
root=Path(__file__).resolve().parents[1]
try:
 for line in (root/'SHA256SUMS.txt').read_text().splitlines():
  expected,name=line.split('  ',1);p=(root/name).resolve()
  if not p.is_relative_to(root):raise ValueError('Unsafe path')
  if hashlib.sha256(p.read_bytes()).hexdigest()!=expected:raise ValueError('Checksum mismatch: '+name)
 print('Package checksum verification passed. This is not application acceptance.')
except Exception as exc:
 print(str(exc),file=sys.stderr);sys.exit(1)
