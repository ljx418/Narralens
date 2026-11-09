"""Linux/WSL private helper. No unsafe os.kill fallback when pidfd is unavailable."""
import os
import signal
import sys

def main():
    if len(sys.argv) != 3 or not sys.argv[1].isdigit() or not sys.argv[2].isdigit():
        return 2
    pid, expected = int(sys.argv[1]), sys.argv[2]
    if pid <= 1 or pid == os.getpid() or not hasattr(os, 'pidfd_open') or not hasattr(signal, 'pidfd_send_signal'):
        return 2
    fd = os.pidfd_open(pid, 0)
    try:
        with open('/proc/%s/stat' % pid, encoding='utf-8') as source:
            raw = source.read()
        fields = raw[raw.rfind(')') + 2:].split()
        if fields[0] == 'Z' or fields[19] != expected:
            return 3
        signal.pidfd_send_signal(fd, signal.SIGTERM, None, 0)
        return 0
    finally:
        os.close(fd)

try:
    sys.exit(main())
except (OSError, ValueError, IndexError):
    sys.exit(4)
