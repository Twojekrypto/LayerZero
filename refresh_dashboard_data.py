#!/usr/bin/env python3
"""
Local entrypoint for refreshing the ZRO dashboard dataset.

Modes:
  - full: mirrors the broader daily scan pipeline
  - hourly: mirrors the lighter monitor/balance refresh pipeline

Examples:
  python3 refresh_dashboard_data.py
  python3 refresh_dashboard_data.py --mode hourly
  python3 refresh_dashboard_data.py --mode full --dry-run
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parent


@dataclass(frozen=True)
class Step:
    name: str
    command: tuple[str, ...]
    soft_fail: bool = False
    required_env: tuple[str, ...] = ()
    optional_env: tuple[str, ...] = ()


PIPELINES = {
    "full": (
        Step("Fetch multichain holders", ("fetch_holders.py",), required_env=("ETHERSCAN_API_KEY",), optional_env=("ALCHEMY_API_KEY",)),
        Step("Merge fresh holder data into zro_data.json", ("update_data.py",)),
        Step("Detect fresh and institutional wallets", ("detect_fresh.py",), soft_fail=True, required_env=("ETHERSCAN_API_KEY",)),
        Step("Generate flow data", ("generate_flows.py",), soft_fail=True, required_env=("ETHERSCAN_API_KEY",)),
        Step("Auto-label new wallets", ("auto_label.py",), soft_fail=True, required_env=("ETHERSCAN_API_KEY",)),
        Step("Update Coinbase Prime transfer history", ("monitor_cb_prime.py",), soft_fail=True, required_env=("ETHERSCAN_API_KEY",)),
        Step("Update whale transfer history", ("monitor_whale_transfers.py",), soft_fail=True, required_env=("ETHERSCAN_API_KEY",)),
    ),
    "hourly": (
        Step("Refresh top holder balances", ("refresh_balances.py",), required_env=("ETHERSCAN_API_KEY",)),
        Step("Update Coinbase Prime transfer history", ("monitor_cb_prime.py",), soft_fail=True, required_env=("ETHERSCAN_API_KEY",)),
        Step("Detect fresh and institutional wallets", ("detect_fresh.py",), soft_fail=True, required_env=("ETHERSCAN_API_KEY",)),
        Step("Update whale transfer history", ("monitor_whale_transfers.py",), soft_fail=True, required_env=("ETHERSCAN_API_KEY",)),
    ),
}

VALIDATION_STEPS = (
    Step("Verify MemPalace consistency rules", ("verify_palace_rules.py",)),
    Step("Run dashboard smoke tests", ("npm", "test")),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Refresh local ZRO dashboard data.")
    parser.add_argument(
        "--mode",
        choices=sorted(PIPELINES.keys()),
        default="full",
        help="Pipeline to run. Default: full.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the planned steps without executing them.",
    )
    parser.add_argument(
        "--skip-validation",
        action="store_true",
        help="Skip verify/test steps after the data pipeline finishes.",
    )
    return parser.parse_args()


def resolve_command(command: tuple[str, ...]) -> list[str]:
    if not command:
        raise ValueError("Empty command")
    if command[0].endswith(".py"):
        return [sys.executable, str(ROOT / command[0]), *command[1:]]
    return list(command)


def missing_env_vars(step: Step) -> list[str]:
    return [var for var in step.required_env if not os.environ.get(var)]


def missing_optional_env_vars(step: Step) -> list[str]:
    return [var for var in step.optional_env if not os.environ.get(var)]


def command_available(command: tuple[str, ...]) -> bool:
    if not command:
        return False
    if command[0].endswith(".py"):
        return (ROOT / command[0]).exists()
    return shutil.which(command[0]) is not None


def print_step(index: int, total: int, step: Step) -> None:
    print(f"[{index}/{total}] {step.name}")


def run_step(step: Step) -> bool:
    argv = resolve_command(step.command)
    started_at = time.time()
    result = subprocess.run(argv, cwd=ROOT)
    duration = time.time() - started_at
    status = "OK" if result.returncode == 0 else f"FAILED ({result.returncode})"
    print(f"    -> {status} in {duration:.1f}s")
    return result.returncode == 0


def run_pipeline(mode: str, dry_run: bool, skip_validation: bool) -> int:
    steps = list(PIPELINES[mode])
    if not skip_validation:
        steps.extend(VALIDATION_STEPS)

    print(f"ZRO local refresh pipeline")
    print(f"Mode: {mode}")
    print(f"Workspace: {ROOT}")

    if dry_run:
        print("Dry run only. Planned steps:")
        for index, step in enumerate(steps, start=1):
            print_step(index, len(steps), step)
            print(f"    $ {' '.join(resolve_command(step.command))}")
        return 0

    failures = []
    for index, step in enumerate(steps, start=1):
        if not command_available(step.command):
            print_step(index, len(steps), step)
            message = f"Skipping: required command '{step.command[0]}' is not available locally."
            if step.soft_fail:
                print(f"    -> {message}")
                continue
            print(f"    -> {message}")
            return 1

        missing_required = missing_env_vars(step)
        if missing_required:
            print_step(index, len(steps), step)
            message = f"Missing environment variables: {', '.join(missing_required)}"
            if step.soft_fail:
                print(f"    -> Skipping optional step. {message}")
                continue
            print(f"    -> Cannot continue. {message}")
            return 1

        missing_optional = missing_optional_env_vars(step)
        print_step(index, len(steps), step)
        if missing_optional:
            print(f"    -> Optional env not set: {', '.join(missing_optional)}")
        if not run_step(step):
            failures.append(step.name)
            if not step.soft_fail:
                print("Pipeline stopped on required step failure.")
                return 1

    if failures:
        print(f"Completed with soft-fail steps: {', '.join(failures)}")
        return 0

    print("Pipeline finished successfully.")
    return 0


def main() -> int:
    args = parse_args()
    return run_pipeline(args.mode, args.dry_run, args.skip_validation)


if __name__ == "__main__":
    raise SystemExit(main())
