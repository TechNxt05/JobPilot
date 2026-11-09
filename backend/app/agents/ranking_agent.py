from typing import Dict, Any, List
from app.graph.state import AgentState
from app.tools.ranking import RankingTool

class RankingAgent:
    def run(self, state: AgentState) -> Dict[str, Any]:
        print("--- RANKING AGENT ---")
        # In this flow, we might want to rank the search results BEFORE scraping, 
        # OR rank the verification facts/sources.
        # Let's assume we re-rank the search results to ensure we scraped the best ones, 
        # or we just add scores to everything.
        
        # Let's add trust scores to verified facts if they exist, or search results.
        # Since this runs after verification in the graph (usually), let's augment verified facts.
        
        verified_facts = state.get("verified_facts") or []
        ranked_facts = []
        
        for fact in verified_facts:
            source_url = fact.get("source_url")
            trust_score = RankingTool.calculate_trust_score(source_url or "")
            fact["trust_score"] = trust_score
            # Adjust confidence based on trust score?
            # heuristic: if trust is low, downgrade confidence
            if trust_score < 0.5 and fact.get("confidence") == "High":
                 fact["confidence"] = "Medium"
            
            ranked_facts.append(fact)
            
        log = {
            "step": "RankingAgent",
            "action": "Ranked Sources",
            "details": {"facts_ranked": len(ranked_facts)}
        }
        
        return {
            "verified_facts": ranked_facts,
            "execution_log": [log]
        }
