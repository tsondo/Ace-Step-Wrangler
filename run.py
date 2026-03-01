"""
ACE-Step Wrangler — unified launcher.

Starts the AceStep API server (GPU, port 8001) and the Wrangler FastAPI UI
server (no GPU, port 7860) as subprocesses, with graceful shutdown on Ctrl+C.

Usage:
    uv run wrangler                   # auto GPU detection
    uv run wrangler --gpu 1           # use GPU 1
    ACESTEP_GPU=0 uv run wrangler
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
_CHECKPOINTS = _HERE / "vendor" / "ACE-Step-1.5" / "checkpoints"


def _ensure_model_symlink() -> str | None:
    """If MODEL_LOCATION is set, symlink vendor checkpoints dir to it.

    Returns the resolved MODEL_LOCATION or None.
    """
    model_loc = os.environ.get("MODEL_LOCATION")
    if not model_loc:
        return None

    target = Path(model_loc)
    if not target.is_dir():
        print(f"[run] WARNING: MODEL_LOCATION={model_loc} is not a directory, ignoring")
        return None

    # Already a correct symlink — nothing to do
    if _CHECKPOINTS.is_symlink():
        if _CHECKPOINTS.resolve() == target.resolve():
            return str(target)
        # Wrong symlink target — fix it
        _CHECKPOINTS.unlink()
        _CHECKPOINTS.symlink_to(target)
        print(f"[run] Updated checkpoints symlink → {target}")
        return str(target)

    # Real directory with files — don't clobber, tell the user
    if _CHECKPOINTS.is_dir() and any(_CHECKPOINTS.iterdir()):
        print(f"[run] WARNING: {_CHECKPOINTS} is a non-empty directory.")
        print(f"  Move its contents to {target} and remove it, then restart.")
        print(f"  Example:  mv {_CHECKPOINTS}/* {target}/ && rmdir {_CHECKPOINTS}")
        return None

    # Empty dir or doesn't exist — safe to create symlink
    if _CHECKPOINTS.is_dir():
        _CHECKPOINTS.rmdir()
    _CHECKPOINTS.symlink_to(target)
    print(f"[run] Created checkpoints symlink → {target}")
    return str(target)


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

    # --- Load .env from project root (won't override existing env vars) -----
    _env_file = _HERE / ".env"
    if _env_file.is_file():
        from dotenv import load_dotenv
        load_dotenv(_env_file, override=False)

    # --- Shared model location (symlink checkpoints → MODEL_LOCATION) ------
    model_location = _ensure_model_symlink()

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
    if model_location:
        print(f"  Models:        {model_location}")
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
