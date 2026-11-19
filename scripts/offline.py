"""Serve the built Aeolus website and local analysis API in one process."""

import argparse
import json
import mimetypes
import os
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend" / "dist"
HOST = "127.0.0.1"


def is_aeolus(url: str) -> bool:
    opener = build_opener(ProxyHandler({}))
    try:
        with opener.open(f"{url}/api/v1/health", timeout=1) as response:
            if json.load(response).get("service") != "aeolus-wra":
                return False
        with opener.open(url, timeout=1) as response:
            return b"<title>Aeolus-Wra" in response.read(4096)
    except (URLError, OSError, ValueError, AttributeError):
        return False


def open_when_ready(url: str) -> None:
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if is_aeolus(url):
            webbrowser.open(url)
            return
        time.sleep(0.25)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=5173)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("端口必须在 1 至 65535 之间。")
    url = f"http://{HOST}:{args.port}"

    with socket.socket() as listener:
        if os.name == "nt":
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        else:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            listener.bind((HOST, args.port))
        except OSError as exc:
            if is_aeolus(url):
                print(f"Aeolus 已在运行：{url}", flush=True)
                if not args.no_browser:
                    webbrowser.open(url)
                return 0
            print(f"无法监听 {url}，请检查端口占用：{exc}", file=sys.stderr)
            return 1

        if not (FRONTEND / "index.html").is_file():
            print(
                "找不到已构建网页。请先运行 npm.cmd --prefix frontend run build。", file=sys.stderr
            )
            return 1

        os.chdir(ROOT)
        try:
            import uvicorn
            from fastapi.staticfiles import StaticFiles
            from wind_platform.main import app
        except ImportError as exc:
            print(f"本机分析环境缺少依赖，请参照 README.md 安装：{exc}", file=sys.stderr)
            return 1

        # Older Windows MIME tables may omit WebP.
        mimetypes.add_type("image/webp", ".webp")
        app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="offline-frontend")
        listener.listen()
        print(f"Aeolus 离线版：{url}  |  按 Ctrl+C 停止服务。", flush=True)
        server = uvicorn.Server(uvicorn.Config(app, host=HOST, port=args.port))
        if not args.no_browser:
            threading.Thread(target=open_when_ready, args=(url,), daemon=True).start()
        server.run(sockets=[listener])
        return 0 if server.started else 1


if __name__ == "__main__":
    raise SystemExit(main())
