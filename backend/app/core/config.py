from pathlib import Path

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/.env, resolved independently of the current working directory
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"

# Export .env values into os.environ too, so libraries that read
# os.getenv (LangChain clients, search tools) see the same keys.
load_dotenv(ENV_FILE)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    PROJECT_NAME: str = "JobPilot"
    GROQ_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    SERPER_API_KEY: str = ""
    GROQ_MODEL: str = "llama-3.3-70b-versatile"
    OPENAI_MODEL: str = "gpt-4o"
    # Fallback providers (any with a key join the chain)
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-flash"
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_MODEL: str = "openai/gpt-4o-mini"
    LLM_FALLBACK_ORDER: str = "groq,gemini,openrouter,openai"
    # Same Supabase project as the web app and extension (URL + anon/publishable key; no service key needed)
    SUPABASE_URL: str = ""
    SUPABASE_ANON_KEY: str = ""
    # Comma-separated list of allowed frontend origins
    CORS_ORIGINS: str = "http://localhost:3000"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


settings = Settings()
