from typing import Any, Dict

from app.core.auth import fetch_profile
from app.graph.state import AgentState


def summarize_profile(p: Dict[str, Any]) -> str:
    """Short context string from the shared (web + extension) profile document."""
    name = " ".join(x for x in [p.get("firstName"), p.get("lastName")] if x)
    edu = (p.get("education") or [{}])[0] or {}
    exp = [e for e in (p.get("experience") or []) if e.get("title") or e.get("company")]
    roles = "; ".join(f"{e.get('title', '')} at {e.get('company', '')}" for e in exp[:4])
    lines = [
        f"Name: {name}" if name else "",
        f"Headline: {p['headline']}" if p.get("headline") else "",
        f"Education: {edu.get('degree', '')} {edu.get('major', '')} at {edu.get('school', '')} (grad {edu.get('endYear', '')})" if edu.get("school") or edu.get("degree") else "",
        f"Experience: {roles}" if exp else "",
        f"Skills: {', '.join((p.get('skills') or [])[:40])}" if p.get("skills") else "",
        f"Location: {', '.join(x for x in [p.get('city'), p.get('country')] if x)}" if p.get("city") or p.get("country") else "",
        f"Additional info: {p['additionalInfo'][:600]}" if p.get("additionalInfo") else "",
    ]
    return "User Context:\n" + "\n".join(f"- {l}" for l in lines if l)


class ProfileContextAgent:
    async def run(self, state: AgentState) -> Dict[str, Any]:
        """Loads the signed-in user's profile from Supabase (as that user, so RLS applies)."""
        print("--- PROFILE CONTEXT AGENT ---")
        token = state.get("access_token")
        if not token:
            return {"execution_log": [{"step": "ProfileContextAgent", "action": "Skipped (not signed in)"}]}
        try:
            profile = await fetch_profile(token)
            if not profile:
                return {"execution_log": [{"step": "ProfileContextAgent", "action": "Skipped (no profile yet)"}]}
            return {
                "user_context": summarize_profile(profile),
                "execution_log": [{
                    "step": "ProfileContextAgent",
                    "action": "Loaded Profile Context",
                    "details": {"user": " ".join(x for x in [profile.get("firstName"), profile.get("lastName")] if x)},
                }],
            }
        except Exception as e:
            print(f"Profile Context Error: {e}")
            return {"errors": [str(e)], "execution_log": [{"step": "ProfileContextAgent", "error": str(e)}]}
