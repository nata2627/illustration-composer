"""Выгрузка материалов тестового из Figma через REST API.

Токен берется из ~/.figma_token, ключ файла из FIGMA_FILE_KEY. Результат в assets/figma.
"""
import json
import os
import pathlib
import sys
import urllib.parse
import urllib.request

FILE_KEY = os.environ["FIGMA_FILE_KEY"]
OUT = pathlib.Path(__file__).parent / "figma"
TOKEN = pathlib.Path.home().joinpath(".figma_token").read_text().strip()


def get(url):
    req = urllib.request.Request(url, headers={"X-Figma-Token": TOKEN})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    doc = json.loads(get(f"https://api.figma.com/v1/files/{FILE_KEY}?geometry=paths"))
    (OUT / "file.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1))

    # все узлы второго и третьего уровня на каждой странице, кроме обложки
    nodes = {}
    for page in doc["document"]["children"]:
        print("page", page["name"])
        for top in page.get("children", []):
            nodes[top["id"]] = f"{page['name']}/{top['name']}"
            for child in top.get("children", []):
                if child["type"] in ("FRAME", "COMPONENT", "GROUP", "INSTANCE", "COMPONENT_SET"):
                    nodes[child["id"]] = f"{page['name']}/{top['name']}/{child['name']}"
    print("nodes", len(nodes))

    ids = list(nodes)
    for fmt in ("svg", "png"):
        for i in range(0, len(ids), 50):
            chunk = ids[i:i + 50]
            q = urllib.parse.urlencode({"ids": ",".join(chunk), "format": fmt,
                                        "svg_include_id": "true", "scale": 1})
            urls = json.loads(get(f"https://api.figma.com/v1/images/{FILE_KEY}?{q}"))["images"]
            for nid, url in urls.items():
                if not url:
                    continue
                name = nodes[nid].replace("/", "__").replace(" ", "_")[:150]
                (OUT / fmt).mkdir(exist_ok=True)
                (OUT / fmt / f"{name}__{nid.replace(':', '-')}.{fmt}").write_bytes(get(url))
    print("done", OUT)


if __name__ == "__main__":
    sys.exit(main())
