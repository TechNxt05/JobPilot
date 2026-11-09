import os
import requests
from typing import List, Dict, Any, Optional
from langchain_community.utilities import DuckDuckGoSearchAPIWrapper

class SearchTools:
    @staticmethod
    def serper_search(query: str, type: str = "search") -> List[Dict[str, Any]]:
        """
        Search using Serper.dev API.
        """
        api_key = os.getenv("SERPER_API_KEY")
        if not api_key:
            print("Warning: SERPER_API_KEY not found. Skipping Serper.")
            return []

        url = "https://google.serper.dev/search"
        payload = {"q": query}
        headers = {
            "X-API-KEY": api_key,
            "Content-Type": "application/json"
        }

        try:
            response = requests.post(url, headers=headers, json=payload, timeout=15)
            response.raise_for_status()
            results = response.json()
            
            # Normalize results
            normalized = []
            if "organic" in results:
                for item in results["organic"]:
                    normalized.append({
                        "title": item.get("title"),
                        "link": item.get("link"),
                        "snippet": item.get("snippet"),
                        "source": "serper"
                    })
            return normalized
        except Exception as e:
            print(f"Serper search failed: {e}")
            return []

    @staticmethod
    def duckduckgo_search(query: str) -> List[Dict[str, Any]]:
        """
        Fallback search using DuckDuckGo.
        """
        try:
            ddg = DuckDuckGoSearchAPIWrapper()
            results = ddg.results(query, max_results=5)
            # DDG wrapper returns list of dicts with 'snippet', 'title', 'link'
            for r in results:
                r["source"] = "duckduckgo"
            return results
        except Exception as e:
            print(f"DDG search failed: {e}")
            return []

    @staticmethod
    def hybrid_search(query: str) -> List[Dict[str, Any]]:
        """
        Search both Serper and DuckDuckGo and merge results.
        """
        results = []
        seen_links = set()

        # 1. Serper
        print(f"Searching Serper for: {query}")
        serper_results = SearchTools.serper_search(query)
        for r in serper_results:
            if r.get("link") and r["link"] not in seen_links:
                results.append(r)
                seen_links.add(r["link"])

        # 2. DuckDuckGo
        print(f"Searching DDG for: {query}")
        ddg_results = SearchTools.duckduckgo_search(query)
        for r in ddg_results:
            if r.get("link") and r["link"] not in seen_links:
                results.append(r)
                seen_links.add(r["link"])
        
        print(f"Total merged results: {len(results)}")
        return results
