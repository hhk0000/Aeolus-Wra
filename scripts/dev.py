"""从项目根目录启动本机开发服务；不依赖 PowerShell 执行策略。"""

import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def check_ports() -> None:
    for port in (8000, 5173):
        with socket.socket() as listener:
            try:
                listener.bind(("127.0.0.1", port))
            except OSError:
                raise SystemExit(f"端口 {port} 已被占用，请先停止已有服务。") from None


def stop_process(process: subprocess.Popen) -> None:
    if os.name == "nt":
        # npm 和 uvicorn reload 都会创建子进程，必须停止整棵进程树。
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass


def main() -> int:
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if npm is None or not (ROOT / "frontend/node_modules").is_dir():
        print("请先按 README 安装 Node.js 和前后端依赖。", file=sys.stderr)
        return 1
    check_ports()
    commands = [
        [
            sys.executable,
            "-m",
            "uvicorn",
            "wind_platform.main:app",
            "--reload",
            "--reload-dir",
            str(ROOT / "backend/src"),
            "--host",
            "127.0.0.1",
            "--port",
            "8000",
        ],
        [npm, "--prefix", str(ROOT / "frontend"), "run", "dev"],
    ]
    processes: list[subprocess.Popen] = []
    try:
        for command in commands:
            kwargs = (
                {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
                if os.name == "nt"
                else {"start_new_session": True}
            )
            processes.append(subprocess.Popen(command, cwd=ROOT, **kwargs))
        print("前端 http://127.0.0.1:5173 | API http://127.0.0.1:8000/docs", flush=True)
        while True:
            for process in processes:
                code = process.poll()
                if code is not None:
                    print(f"开发服务退出，退出码 {code}。", file=sys.stderr)
                    return code if code != 0 else 1
            time.sleep(0.25)
    except KeyboardInterrupt:
        return 0
    finally:
        for process in reversed(processes):
            stop_process(process)
        for process in processes:
            process.wait()


if __name__ == "__main__":
    raise SystemExit(main())
