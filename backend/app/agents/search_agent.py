from typing import Dict, Any
from app.graph.state import AgentState
from app.tools.search import SearchTools

class SearchAgent:
    def run(self, state: AgentState) -> Dict[str, Any]:
        print("--- SEARCH AGENT ---")
        intent = state.get("intent") or {}
        queries = intent.get("queries") or []
        
        all_results = []
        
        if not queries:
            # Fallback if no specific queries
            queries = [state["query"]]

        for q in queries:
            print(f"Searching for: {q}")
            results = SearchTools.hybrid_search(q)
            all_results.extend(results)

        # Deduplicate based on link
        seen_links = set()
        unique_results = []
        for r in all_results:
            if r["link"] not in seen_links:
                unique_results.append(r)
                seen_links.add(r["link"])
        
        # Log execution
        log = {
            "step": "SearchAgent",
            "action": "Performed Search",
            "details": {"queries": queries, "results_count": len(unique_results)}
        }
        
        # Append log to existing logs in the state wrapper (managed by Graph)
        # But here we return the dict update
        return {
            "search_results": unique_results,
            "execution_log": [log] 
        }
