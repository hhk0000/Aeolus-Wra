"""Install an immutable, comment-free template release; activation is a separate edit."""

import argparse
import hashlib
import re
from io import BytesIO
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from lxml import etree as ET

ROOT = Path(__file__).resolve().parents[1] / "backend/src/wind_platform/report_templates"


def publish(source, family, version, *, strip_review_highlight=None):
    if not re.fullmatch(r"[a-z][a-z0-9-]*", family) or not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Invalid template ID or version")
    buf = BytesIO()
    with ZipFile(source) as src, ZipFile(buf, "w", ZIP_DEFLATED) as dst:
        for name in src.namelist():
            if name.startswith(("word/comments", "word/people.")):
                continue
            data = src.read(name)
            if name.endswith((".xml", ".rels")):
                root = ET.fromstring(data)
                for e in list(root.iterdescendants()):
                    tag = ET.QName(e).localname
                    target = e.get("Type", "") + e.get("PartName", "")
                    review_highlight = (
                        tag == "highlight"
                        and strip_review_highlight is not None
                        and strip_review_highlight in e.attrib.values()
                    )
                    if (
                        tag.startswith("comment")
                        or tag == "trackRevisions"
                        or review_highlight
                        or (
                            tag in {"Relationship", "Override"}
                            and ("comment" in target.lower() or "people" in target.lower())
                        )
                    ):
                        e.getparent().remove(e)
                data = ET.tostring(root, encoding="UTF-8", xml_declaration=True, standalone=True)
            dst.writestr(name, data)
    version_number = tuple(map(int, version.split(".")))
    if family == "mesoscale" and version_number >= (1, 3, 0):
        from docx import Document
        from wind_platform.services.approved_assessment_template import validate_release

        validate_release(Document(buf), reviewed_layout=version_number >= (1, 3, 1))
    path = ROOT / family / (version + ".docx")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as f:
        f.write(buf.getvalue())
    print(hashlib.sha256(buf.getvalue()).hexdigest())


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for arg in ("source", "family", "version"):
        parser.add_argument(arg)
    parser.add_argument("--strip-review-highlight")
    args = parser.parse_args()
    publish(
        args.source, args.family, args.version, strip_review_highlight=args.strip_review_highlight
    )
