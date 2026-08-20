from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import pandas as pd
import requests


@dataclass(frozen=True)
class ExplorerDataset:
    manifest: dict[str, Any]
    tables: dict[str, pd.DataFrame]


def _get(base_url: str, path: str, token: str, params: dict[str, str] | None = None) -> dict[str, Any]:
    response = requests.get(
        f"{base_url.rstrip('/')}{path}",
        headers={"Authorization": f"Bearer {token}"},
        params=params,
        timeout=120,
    )
    response.raise_for_status()
    return response.json()


def load_explorer_dataset(base_url: str, dataset_id: str, token: str) -> ExplorerDataset:
    rows: dict[str, list[dict[str, Any]]] = {}
    manifest: dict[str, Any] | None = None
    trace_offset = 0
    while True:
        payload = _get(
            base_url,
            f"/v1/datasets/{quote(dataset_id, safe='')}/analysis-export",
            token,
            params={"trace_offset": str(trace_offset), "trace_limit": "10"},
        )
        manifest = payload["dataset"]
        for name, page_rows in payload["tables"].items():
            rows.setdefault(name, []).extend(page_rows)
        next_trace_offset = payload["page"].get("next_trace_offset")
        if next_trace_offset is None:
            break
        trace_offset = next_trace_offset
    return ExplorerDataset(
        manifest=manifest or {},
        tables={name: pd.DataFrame(table_rows) for name, table_rows in rows.items()},
    )


def load_explorer_trace(base_url: str, dataset_id: str, trace_id: str, token: str) -> dict[str, Any]:
    return _get(
        base_url,
        f"/v1/traces/{quote(trace_id, safe='')}",
        token,
        params={"dataset_id": dataset_id},
    )["trace"]


def load_explorer_activity(base_url: str, dataset_id: str, trace_id: str, token: str) -> dict[str, Any]:
    return _get(
        base_url,
        f"/v1/traces/{quote(trace_id, safe='')}/activity",
        token,
        params={"dataset_id": dataset_id},
    )["activity"]
