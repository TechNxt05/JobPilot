import asyncio
from typing import Optional
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright

class ScraperTool:
    @staticmethod
    async def scrape_url(url: str) -> str:
        """
        Scrape a URL using Playwright for JS support, falling back to basic extraction.
        Returns markdown-friendly text content.
        """
        content = ""
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])  # small /dev/shm in containers
                # Create a new context with a user agent to avoid bot detection
                context = await browser.new_context(
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
                )
                page = await context.new_page()
                
                try:
                    await page.goto(url, timeout=30000, wait_until="domcontentloaded")
                    content = await page.content()
                except Exception as e:
                    print(f"Playwright navigation failed for {url}: {e}")
                finally:
                    await browser.close()
        except Exception as e:
             print(f"Playwright failed: {e}")

        if not content:
            return f"Failed to retrieve content from {url}"

        # Parse with BeautifulSoup to get text
        soup = BeautifulSoup(content, "html.parser")
        
        # Remove script and style elements
        for script in soup(["script", "style", "nav", "footer", "header"]):
            script.decompose()
            
        text = soup.get_text(separator="\n")
        
        # Clean up lines
        lines = (line.strip() for line in text.splitlines())
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        clean_text = '\n'.join(chunk for chunk in chunks if chunk)
        
        return clean_text[:8000] # Limit content size
