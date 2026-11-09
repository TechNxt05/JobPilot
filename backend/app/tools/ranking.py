from urllib.parse import urlparse

class RankingTool:
    TRUST_SCORES = {
        "official_career": 1.0,
        "linkedin": 0.8,
        "govt_edu": 0.85,
        "job_board": 0.6,
        "blog": 0.4,
        "forum": 0.3,
        "unknown": 0.5
    }

    @staticmethod
    def classify_source_type(url: str) -> str:
        """
        Heuristic to classify source type from URL.
        """
        domain = urlparse(url).netloc.lower()
        
        if "careers" in domain or "jobs" in domain or "workat" in domain:
            return "official_career" # Heuristic, not perfect
        if "linkedin.com" in domain:
            return "linkedin"
        if ".gov" in domain or ".edu" in domain:
            return "govt_edu"
        if "internshala" in domain or "indeed" in domain or "naukri" in domain:
            return "job_board"
        if "medium.com" in domain or "blog" in domain:
            return "blog"
        if "reddit.com" in domain or "quora.com" in domain:
            return "forum"
        
        # Check specific company pages manually if known or assume unknown
        return "unknown"

    @staticmethod
    def calculate_trust_score(url: str) -> float:
        source_type = RankingTool.classify_source_type(url)
        return RankingTool.TRUST_SCORES.get(source_type, 0.5)
