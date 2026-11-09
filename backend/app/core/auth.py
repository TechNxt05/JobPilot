"""Supabase authentication for the API.

Every protected endpoint requires `Authorization: Bearer <supabase access token>`. The token is
validated by asking Supabase Auth who it belongs to (GET /auth/v1/user), so no JWT secret is needed
here and revoked sessions stop working. Results are cached briefly to avoid a round trip per request.
"""
import time
from dataclasses import dataclass

import httpx
from fastapi import Header, HTTPException

from app.core.config import settings

_CACHE_TTL = 60.0
_cache: dict[str, tuple[float, "CurrentUser"]] = {}


@dataclass(frozen=True)
class CurrentUser:
    id: str
    email: str | None
    token: str


async def _lookup(token: str) -> CurrentUser:
    if not settings.SUPABASE_URL or not settings.SUPABASE_ANON_KEY:
        raise HTTPException(status_code=500, detail="Server auth isn't configured (SUPABASE_URL / SUPABASE_ANON_KEY)")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(
                f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/user",
                headers={"apikey": settings.SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}"},
            )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail=f"Couldn't reach Supabase Auth: {e}") from e
    if res.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid or expired session. Sign in again.")
    data = res.json()
    return CurrentUser(id=data["id"], email=data.get("email"), token=token)


async def get_current_user(authorization: str | None = Header(default=None)) -> CurrentUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Sign in required")
    token = authorization.split(" ", 1)[1].strip()
    now = time.monotonic()
    hit = _cache.get(token)
    if hit and hit[0] > now:
        return hit[1]
    user = await _lookup(token)
    _cache[token] = (now + _CACHE_TTL, user)
    if len(_cache) > 5000:  # crude bound
        for k in [k for k, (exp, _) in _cache.items() if exp <= now]:
            _cache.pop(k, None)
    return user


async def fetch_profile(token: str) -> dict | None:
    """The user's synced profile document (same format the web app and extension write), via RLS."""
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(
            f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/profiles",
            params={"select": "data,deleted_at"},
            headers={"apikey": settings.SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}"},
        )
    if res.status_code != 200:
        return None
    rows = res.json()
    return rows[0]["data"] if rows and rows[0].get("data") and not rows[0].get("deleted_at") else None
