"""LLM factory with automatic provider fallback.

get_llm("groq") returns Groq with fallbacks to every other provider that has a key, in
LLM_FALLBACK_ORDER (default groq → gemini → openrouter → openai). If the primary fails
(bad key, rate limit, outage), LangChain retries the same call on the next provider.
"""
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.runnables import Runnable

from app.core.config import settings

PROVIDERS = ("groq", "gemini", "openrouter", "openai")


TIMEOUT = 45  # seconds per provider before falling back


def _real(key: str) -> str:
    """Empty string for unset keys and .env template placeholders like "your_openai_api_key"."""
    k = (key or "").strip()
    return "" if not k or k.lower().startswith(("your_", "your-", "<", "xxx", "changeme", "replace")) else k


def _key(provider: str) -> str:
    return _real({
        "groq": settings.GROQ_API_KEY,
        "gemini": settings.GEMINI_API_KEY,
        "openrouter": settings.OPENROUTER_API_KEY,
        "openai": settings.OPENAI_API_KEY,
    }[provider])


def _build(provider: str, model_name: str | None = None) -> BaseChatModel:
    if provider == "groq":
        from langchain_groq import ChatGroq
        return ChatGroq(temperature=0, model=model_name or settings.GROQ_MODEL, api_key=_key("groq") or None, max_retries=1, timeout=TIMEOUT)
    if provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(temperature=0, model=model_name or settings.GEMINI_MODEL, google_api_key=_key("gemini"), max_retries=1, timeout=TIMEOUT)
    if provider == "openrouter":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(temperature=0, model=model_name or settings.OPENROUTER_MODEL, api_key=_key("openrouter"),
                          base_url="https://openrouter.ai/api/v1", max_retries=1, timeout=TIMEOUT, default_headers={"X-Title": "JobPilot"})
    if provider == "openai":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(temperature=0, model=model_name or settings.OPENAI_MODEL, api_key=_key("openai") or None, max_retries=1, timeout=TIMEOUT)
    raise ValueError(f"Unknown provider: {provider}")


def fallback_order(primary: str) -> list[str]:
    order = [p.strip() for p in settings.LLM_FALLBACK_ORDER.split(",") if p.strip() in PROVIDERS]
    order = [primary] + [p for p in order if p != primary]
    with_keys = [p for p in order if _key(p)]
    # Keep the primary even without a key so errors are explicit rather than silent
    return with_keys or [primary]


class LLMFactory:
    @staticmethod
    def get_llm(provider: str = "groq", model_name: str | None = None) -> Runnable:
        """Primary provider with fallbacks. `model_name` applies to the primary only."""
        order = fallback_order(provider)
        primary = _build(order[0], model_name if order[0] == provider else None)
        rest = [_build(p) for p in order[1:]]
        return primary.with_fallbacks(rest) if rest else primary
