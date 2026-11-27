"""Local development store. Originals and derived products are separate, append-only."""

import hashlib
import json
import os
import re
from pathlib import Path
from uuid import uuid4

from wind_platform.core.calculations import CalculationError
from wind_platform.core.standards import METHODS, STANDARDS


class LocalStore:
    def __init__(self, root: Path | None = None):
        self.root = root or Path(os.environ.get("AEOLUS_DATA_DIR", "data/engine"))

    def put(self, collection: str, data: dict, id_: str | None = None) -> dict:
        id_ = id_ or uuid4().hex
        folder = self.root / collection
        folder.mkdir(parents=True, exist_ok=True)
        data = dict(data, id=id_)
        if collection == "runs":
            used = {output["method"] for output in data.get("outputs", {}).values()}
            data["methods"] = {m["id"]: m for m in METHODS if m["id"] in used}
            sources = {m["source"] for m in data["methods"].values()}
            data["standards"] = [s for s in STANDARDS if s["id"] in sources]
        with (folder / f"{id_}.json").open("x", encoding="utf-8") as stream:
            json.dump(data, stream, ensure_ascii=False, allow_nan=False)
        return data

    def get(self, collection: str, id_: str) -> dict:
        if not re.fullmatch(r"[0-9a-f]{32,64}", id_):
            raise CalculationError("无效的数据标识。")
        try:
            return json.loads((self.root / collection / f"{id_}.json").read_text(encoding="utf-8"))
        except FileNotFoundError as exc:
            raise CalculationError("本地数据不存在，请重新导入。") from exc

    def original(self, content: bytes) -> str:
        digest = hashlib.sha256(content).hexdigest()
        folder = self.root / "originals"
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{digest}.bin"
        try:
            with path.open("xb") as stream:
                stream.write(content)
        except FileExistsError:
            if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                raise CalculationError("原始文件哈希校验失败。") from None
        return digest

    def read_original(self, digest: str) -> bytes:
        if not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise CalculationError("原始文件哈希无效。")
        content = (self.root / "originals" / f"{digest}.bin").read_bytes()
        if hashlib.sha256(content).hexdigest() != digest:
            raise CalculationError("原始文件哈希校验失败。")
        return content
