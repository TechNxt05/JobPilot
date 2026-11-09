from typing import Dict, Any, List
from app.graph.state import AgentState
from app.tools.search import SearchTools

class DiscoveryAgent:
    def run(self, state: AgentState) -> Dict[str, Any]:
        """
        Finds specific application links and relevant people.
        """
        print("--- DISCOVERY AGENT ---")
        intent = state.get("intent") or {}
        query = state.get("query", "")
        
        # We can run these in parallel
        # 1. Find Apply Links
        company = intent.get("company") or ""
        role = intent.get("role") or ""
        location = intent.get("location") or ""
        apply_query = " ".join(f"{company} {role} internship apply official career page".split())
        apply_results = SearchTools.hybrid_search(apply_query)
        
        apply_links = []
        for r in apply_results[:3]:
            apply_links.append({"title": r.get("title", ""), "link": r["link"], "type": "Apply"})

        # 2. Find People (Recruiters/Alumni)
        # Note: LinkedIn scraping is hard/blocked often. We rely on public SERP snippets.
        people_query = " ".join(f"{company} University Recruiter LinkedIn {location}".split())
        people_results = SearchTools.hybrid_search(people_query)
        
        people_links = []
        for r in people_results[:3]:
            if "linkedin.com/in" in r["link"]:
                people_links.append({"title": r.get("title", ""), "link": r["link"], "type": "Recruiter/Peer"})

        # Update state with discovered info. 
        # We might want to append this to 'verified_facts' or a new key 'discovery_data'
        
        discovery_data = {
            "apply_links": apply_links,
            "people": people_links
        }
        
        log = {
            "step": "DiscoveryAgent",
            "action": "Found Links & People",
            "details": {"apply_count": len(apply_links), "people_count": len(people_links)}
        }
        
        return {
            "discovery_data": discovery_data,
            "execution_log": [log]
        }
