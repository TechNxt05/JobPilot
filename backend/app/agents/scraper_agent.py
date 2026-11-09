import asyncio
from typing import Dict, Any, List
from app.graph.state import AgentState
from app.tools.scraper import ScraperTool

class ScraperAgent:
    def __init__(self):
        self.max_urls = 3 # Limit to top 3 for performance

    async def run(self, state: AgentState) -> Dict[str, Any]:
        print("--- SCRAPER AGENT ---")
        search_results = state.get("search_results") or []
        
        # Prioritize results? For now just take top N
        urls_to_scrape = [r["link"] for r in search_results[:self.max_urls]]
        
        scraped_data = []
        
        # Run scraping in parallel
        tasks = [ScraperTool.scrape_url(url) for url in urls_to_scrape]
        results = await asyncio.gather(*tasks)
        
        for url, content in zip(urls_to_scrape, results):
            if content and not content.startswith("Failed"):
                scraped_data.append({
                    "url": url,
                    "content": content
                })
        
        log = {
            "step": "ScraperAgent",
            "action": "Scraped Content",
            "details": {"urls_attempted": len(urls_to_scrape), "successful": len(scraped_data)}
        }
        
        return {
            "scraped_content": scraped_data,
            "execution_log": [log]
        }
