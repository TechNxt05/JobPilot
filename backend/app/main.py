import io
import json

import pdfplumber
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.agents.job_agent import JobSearchAgent
from app.agents.resume_scorer import ResumeScorerAgent
from app.core.auth import CurrentUser, get_current_user
from app.core.config import settings
from app.core.matching import JobMatcher
from app.graph.workflow import app_graph

MAX_RESUME_BYTES = 5 * 1024 * 1024  # 5 MB

app = FastAPI(title="JobPilot API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=False,  # auth is a bearer token, not cookies
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    query: str


class JobSearchRequest(BaseModel):
    role: str
    location: str


class JobMatchRequest(BaseModel):
    resume_text: str
    job_description: str


class ResumeScoreRequest(BaseModel):
    resume_text: str


@app.get("/")
def read_root():
    return {"message": "JobPilot API is running"}


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.post("/resume/extract")
async def extract_resume(file: UploadFile = File(...), user: CurrentUser = Depends(get_current_user)):
    """PDF → plain text. Parsing into a profile happens in the shared TypeScript core (web + extension)."""
    if file.content_type not in ("application/pdf", "application/x-pdf") and not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF resumes are supported")
    contents = await file.read()
    if len(contents) > MAX_RESUME_BYTES:
        raise HTTPException(status_code=413, detail="Resume must be 5 MB or smaller")
    try:
        with pdfplumber.open(io.BytesIO(contents)) as pdf:
            text = "\n".join(page.extract_text() or "" for page in pdf.pages).strip()
    except Exception:
        text = ""
    if len(text.split()) < 30:
        raise HTTPException(status_code=400, detail="Could not extract text from this PDF (scanned/image-only PDFs aren't supported)")
    return {"text": text}


@app.post("/jobs/search")
async def search_jobs_endpoint(request: JobSearchRequest, user: CurrentUser = Depends(get_current_user)):
    try:
        return {"jobs": await JobSearchAgent().search_jobs(request.role, request.location)}
    except Exception as e:
        print(f"Search Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/jobs/match")
async def match_job_endpoint(request: JobMatchRequest, user: CurrentUser = Depends(get_current_user)):
    try:
        return await JobMatcher().match_resume_to_job(request.resume_text, request.job_description)
    except Exception as e:
        print(f"Match Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/resume/score")
async def score_resume_endpoint(request: ResumeScoreRequest, user: CurrentUser = Depends(get_current_user)):
    try:
        return await ResumeScorerAgent().score_resume(request.resume_text)
    except Exception as e:
        print(f"Score Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/chat")
async def chat_endpoint(request: ChatRequest, user: CurrentUser = Depends(get_current_user)):
    async def event_generator():
        try:
            # Each event is one node's state update, e.g. {"search": {"search_results": [...]}}
            state = {"query": request.query, "user_id": user.id, "access_token": user.token}
            async for event in app_graph.astream(state):
                yield f"data: {json.dumps(event, default=str)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
