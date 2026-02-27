"""
ACE-Step Wrangler — unified launcher.

Starts the AceStep API server (GPU, port 8001) and the Wrangler FastAPI UI
server (no GPU, port 7860) as subprocesses, with graceful shutdown on Ctrl+C.

Usage:
    uv run python run.py              # auto GPU detection
    uv run python run.py --gpu 1      # use GPU 1
    ACESTEP_GPU=0 uv run python run.py
"""

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

# AceStep environment variables that are forwarded if set by the user.
# These are never set by default — they are user overrides only.
_ACESTEP_PASSTHROUGH_VARS = [
    "ACESTEP_DEVICE",
    "MAX_CUDA_VRAM",
    "ACESTEP_VAE_ON_CPU",
    "ACESTEP_LM_BACKEND",
    "ACESTEP_INIT_LLM",
]

_HERE = Path(__file__).resolve().parent


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Launch AceStep API + Wrangler UI servers",
    )
    parser.add_argument(
        "--gpu",
        type=str,
        default=None,
        help="GPU device(s) for AceStep (e.g. 0, 1, 0,1). "
             "Sets CUDA_VISIBLE_DEVICES on the AceStep subprocess. "
             "Overrides ACESTEP_GPU env var.",
    )
    parser.add_argument(
        "--acestep-port",
        type=int,
        default=8001,
        help="Port for the AceStep API server (default: 8001)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=7860,
        help="Port for the Wrangler UI server (default: 7860)",
    )
    args = parser.parse_args()

    # --- GPU selection: --gpu flag > ACESTEP_GPU env > auto -----------------
    gpu = args.gpu or os.environ.get("ACESTEP_GPU")

    # --- Build environment for AceStep subprocess ---------------------------
    acestep_env = os.environ.copy()
    if gpu:
        acestep_env["CUDA_VISIBLE_DEVICES"] = gpu

    # --- Build environment for Wrangler (no GPU needed) ---------------------
    wrangler_env = os.environ.copy()
    wrangler_env.pop("CUDA_VISIBLE_DEVICES", None)

    # --- Startup banner -----------------------------------------------------
    gpu_display = gpu if gpu else "auto"
    active_overrides = {
        k: os.environ[k] for k in _ACESTEP_PASSTHROUGH_VARS if k in os.environ
    }

    print()
    print("=" * 60)
    print("  ACE-Step Wrangler")
    print("=" * 60)
    print(f"  GPU:           {gpu_display}")
    print(f"  AceStep API:   http://localhost:{args.acestep_port}")
    print(f"  Wrangler UI:   http://localhost:{args.port}")
    if active_overrides:
        print("-" * 60)
        print("  AceStep env overrides:")
        for k, v in active_overrides.items():
            print(f"    {k}={v}")
    print("=" * 60)
    print()

    # --- Launch subprocesses ------------------------------------------------
    procs: list[subprocess.Popen] = []

    try:
        # 1) AceStep API server
        acestep_cmd = [
            sys.executable, "-m", "acestep.api_server",
            "--host", "127.0.0.1",
            "--port", str(args.acestep_port),
        ]
        print(f"[run] Starting AceStep API server on port {args.acestep_port}...")
        acestep_proc = subprocess.Popen(acestep_cmd, env=acestep_env)
        procs.append(acestep_proc)

        # Brief pause so AceStep begins initialization before Wrangler starts
        time.sleep(1)

        # 2) Wrangler FastAPI server
        wrangler_cmd = [
            sys.executable, str(_HERE / "backend" / "main.py"),
        ]
        print(f"[run] Starting Wrangler UI on port {args.port}...")
        wrangler_proc = subprocess.Popen(wrangler_cmd, env=wrangler_env)
        procs.append(wrangler_proc)

        # Wait for either process to exit (or Ctrl+C)
        while True:
            for proc in procs:
                ret = proc.poll()
                if ret is not None:
                    name = "AceStep" if proc is acestep_proc else "Wrangler"
                    print(f"\n[run] {name} exited (code {ret}). Shutting down...")
                    raise SystemExit(ret)
            time.sleep(0.5)

    except KeyboardInterrupt:
        print("\n[run] Ctrl+C received, shutting down...")
    except SystemExit:
        pass
    finally:
        for proc in procs:
            if proc.poll() is None:
                proc.terminate()
        for proc in procs:
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        print("[run] All servers stopped.")


if __name__ == "__main__":
    main()
