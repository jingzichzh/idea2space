import json
from functools import lru_cache
from pathlib import Path
from typing import Any


CATALOG_PATH = Path(__file__).resolve().parents[1] / "hf_ecosystem_catalog.json"
ASSET_CATALOG_PATH = Path(__file__).resolve().parents[1] / "hf_asset_catalog.json"


@lru_cache(maxsize=1)
def load_hf_catalog() -> dict[str, Any]:
    with CATALOG_PATH.open("r", encoding="utf-8") as catalog_file:
        return json.load(catalog_file)


def catalog_as_prompt_context() -> str:
    catalog = load_hf_catalog()
    return json.dumps(catalog, indent=2)


@lru_cache(maxsize=1)
def load_hf_asset_catalog() -> dict[str, Any]:
    with ASSET_CATALOG_PATH.open("r", encoding="utf-8") as catalog_file:
        return json.load(catalog_file)


def asset_catalog_as_prompt_context() -> str:
    catalog = load_hf_asset_catalog()
    return json.dumps(catalog, indent=2)
