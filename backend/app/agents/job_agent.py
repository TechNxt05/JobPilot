
import asyncio
from typing import List, Dict, Any, Optional
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser
from app.core.llm import LLMFactory
from app.tools.search import SearchTools
from app.tools.scraper import ScraperTool

class JobSearchAgent:
    def __init__(self):
        # Using a fast model for extraction
        self.llm = LLMFactory.get_llm(provider="groq")
        self.parser = JsonOutputParser()

    async def search_jobs(self, role: str, location: str, limit: int = 5) -> List[Dict[str, Any]]:
        """
        Search for jobs, scrape top results, and extract structured data.
        """
        full_results = []
        
        # Construct multiple queries to get better coverage
        queries = [
            f"{role} internships in {location} site:linkedin.com/jobs",
            f"{role} intern {location} site:indeed.com",
            f"{role} internship opportunities {location} site:glassdoor.com",
            f"{role} internship {location} apply now",
        ]
        
        # 1. Search (Parallel)
        search_tasks = [self._search_query(q) for q in queries]
        results_lists = await asyncio.gather(*search_tasks)
        
        # Flatten and Deduplicate
        seen_links = set()
        unique_results = []
        for r_list in results_lists:
            for r in r_list:
                link = r.get("link")
                if link and link not in seen_links:
                    unique_results.append(r)
                    seen_links.add(link)
        
        if not unique_results:
            return []

        # 2. Scrape Top N Results (Parallel)
        # Limit the number of pages to scrape to avoid timeouts
        links_to_scrape = unique_results[:limit]
        
        scrape_tasks = []
        for res in links_to_scrape:
            # Pass the snippet as fallback content if scraping fails
            scrape_tasks.append(self._scrape_and_parse(res))
            
        print(f"Processing {len(scrape_tasks)} job pages...")
        jobs = await asyncio.gather(*scrape_tasks)
        
        # Filter None
        valid_jobs = [j for j in jobs if j]
        return valid_jobs

    async def _search_query(self, query: str):
        # Wrap sync search in async
        return await asyncio.to_thread(SearchTools.hybrid_search, query)

    async def _scrape_and_parse(self, meta: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        url = meta.get("link")
        if not url: return None
        
        try:
            # 1. Scrape
            content = await ScraperTool.scrape_url(url)
            if "Failed to retrieve" in content:
                print(f"Scraping failed for {url}, using snippet only.")
                content = meta.get("snippet", "")
            
            # 2. Parse with LLM
            prompt_text = """
            You are a Job Extraction AI.
            Analyze the provided job posting content and extract structured details.
            
            Content:
            {content}
            
            Metadata (Snippet): {snippet}
            Original Link: {link}
            
            Extract these fields in strict JSON format:
            {{
                "role": "Job Title",
                "company": "Company Name",
                "location": "City, Country or Remote",
                "type": "Internship or Full-time",
                "stipend": "Amount or 'Unpaid' or 'Not disclosed'",
                "description": "Brief summary (max 3 sentences)",
                "skills_required": ["Skill 1", "Skill 2"],
                "apply_link": "Direct application URL (if found in text, else use original link)"
            }}
            
            If the content is NOT a job posting, return null.
            """
            
            prompt = ChatPromptTemplate.from_template(prompt_text)
            chain = prompt | self.llm | self.parser
            
            result = await chain.ainvoke({
                "content": content[:8000], # Truncate to fit context
                "snippet": meta.get("snippet", ""),
                "link": url
            })
            
            if not result: return None
            
            # Ensure critical fields exist
            if not result.get("role"): result["role"] = meta.get("title", "Unknown Role")
            if not result.get("apply_link"): result["apply_link"] = url
            
            return result
            
        except Exception as e:
            print(f"Error processing job {url}: {e}")
            return None
