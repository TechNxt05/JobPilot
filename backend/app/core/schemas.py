from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

class UserIntent(BaseModel):
    role: Optional[str] = Field(None, description="The job role, e.g., 'ML Intern', 'Software Engineer'")
    company: Optional[str] = Field(None, description="Target company, e.g., 'Amazon'")
    location: Optional[str] = Field(None, description="Location, e.g., 'India', 'Remote'")
    batch_year: Optional[str] = Field(None, description="Graduation batch or year, e.g., '2026'")
    queries: List[str] = Field(..., description="List of specific search queries to run")

class SearchResult(BaseModel):
    title: str
    link: str
    snippet: str
    source: str

class ScrapedContent(BaseModel):
    url: str
    content: str
