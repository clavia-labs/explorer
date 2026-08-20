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
    payload = _get(
        base_url,
        f"/v1/datasets/{quote(dataset_id, safe='')}/analysis-export",
        token,
    )
    return ExplorerDataset(
        manifest=payload["dataset"],
        tables={name: pd.DataFrame(rows) for name, rows in payload["tables"].items()},
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
