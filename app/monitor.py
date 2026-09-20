"""서버(이 PC)의 사양·사용량·남은 용량을 조회한다."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Optional

import psutil


def _disk_stats(label: str, path: Path) -> Optional[dict]:
    try:
        total, used, free = shutil.disk_usage(str(path))
    except OSError:
        return None
    return {
        "label": label,
        "drive": str(Path(path).resolve().anchor),
        "total_gb": round(total / 1e9, 1),
        "used_gb": round(used / 1e9, 1),
        "free_gb": round(free / 1e9, 1),
        "used_percent": round(used / total * 100, 1) if total else 0,
    }


def _gpu_stats() -> Optional[dict]:
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=3,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return None
    if result.returncode != 0 or not result.stdout.strip():
        return None

    line = result.stdout.strip().splitlines()[0]
    parts = [p.strip() for p in line.split(",")]
    if len(parts) < 5:
        return None
    name, util, mem_used, mem_total, temp = parts
    try:
        return {
            "name": name,
            "utilization_percent": float(util),
            "memory_used_mb": float(mem_used),
            "memory_total_mb": float(mem_total),
            "memory_used_percent": round(float(mem_used) / float(mem_total) * 100, 1) if float(mem_total) else 0,
            "temperature_c": float(temp),
        }
    except ValueError:
        return None


def collect_status(project_root: Path) -> dict:
    cpu_percent = psutil.cpu_percent(interval=0.3)
    vm = psutil.virtual_memory()

    disks = []
    seen_drives = set()
    for label, path in [
        ("이 프로그램이 있는 드라이브", project_root),
        ("시스템(C:) 드라이브", Path("C:/")),
    ]:
        stat = _disk_stats(label, path)
        if stat and stat["drive"] not in seen_drives:
            seen_drives.add(stat["drive"])
            disks.append(stat)

    return {
        "cpu_percent": cpu_percent,
        "cpu_count": psutil.cpu_count(logical=True),
        "ram_used_gb": round(vm.used / 1e9, 1),
        "ram_total_gb": round(vm.total / 1e9, 1),
        "ram_percent": vm.percent,
        "disks": disks,
        "gpu": _gpu_stats(),
    }
