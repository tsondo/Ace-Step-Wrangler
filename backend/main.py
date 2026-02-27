# ACE-Step Wrangler — FastAPI backend
# Stage 1 stub: no endpoints wired yet.
# See PROJECT_PLAN.md Stage 5 for full implementation.

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="ACE-Step Wrangler")

# Serve frontend
app.mount("/", StaticFiles(directory="../frontend", html=True), name="frontend")
