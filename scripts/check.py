"""执行与 CI 一致的检查，任一步失败即返回非零退出码。"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if npm is None:
        print("未找到 npm，请先安装 Node.js。", file=sys.stderr)
        return 1
    commands = [
        [
            sys.executable,
            "-m",
            "ruff",
            "check",
            "--config",
            "backend/pyproject.toml",
            "backend",
            "tests",
            "scripts",
        ],
        [
            sys.executable,
            "-m",
            "ruff",
            "format",
            "--check",
            "--config",
            "backend/pyproject.toml",
            "backend",
            "tests",
            "scripts",
        ],
        [sys.executable, "-m", "pytest", "-c", "backend/pyproject.toml", "-q"],
        [npm, "--prefix", "frontend", "run", "lint"],
        [npm, "--prefix", "frontend", "run", "format:check"],
        [npm, "--prefix", "frontend", "run", "build"],
    ]
    for command in commands:
        print(f"\n> {' '.join(command)}", flush=True)
        result = subprocess.run(command, cwd=ROOT, check=False)
        if result.returncode:
            return result.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
