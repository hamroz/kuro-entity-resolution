import importlib.util
from pathlib import Path


def test_prefect_flow_runs_without_prefect(tmp_path):
    path = Path(__file__).resolve().parents[1] / "flows" / "resolve_flow.py"
    spec = importlib.util.spec_from_file_location("resolve_flow", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    log = tmp_path / "log.json"
    first = mod.entity_resolution(str(log))
    second = mod.entity_resolution(str(log))
    assert first["documents"] == 9
    assert first == second  # idempotent re-run over the same append-only log
