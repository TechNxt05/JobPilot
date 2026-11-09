from typing import Dict, Any, List
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser
from app.core.llm import LLMFactory
from app.graph.state import AgentState

class VerificationAgent:
    def __init__(self):
        self.llm = LLMFactory.get_llm(provider="openai") # Use strong model for verification
        self.parser = JsonOutputParser()

    def run(self, state: AgentState) -> Dict[str, Any]:
        print("--- VERIFICATION AGENT ---")
        intent = state.get("intent") or {}
        scraped_content = state.get("scraped_content") or []
        
        if not scraped_content:
             return {
                "verified_facts": [],
                "execution_log": [{"step": "VerificationAgent", "action": "No content to verify"}]
            }

        # Prepare content for LLM
        # Truncate content if too large
        context_str = ""
        for item in scraped_content:
            context_str += f"Source: {item['url']}\nContent: {item['content'][:4000]}\n\n"

        system_prompt = """You are a Fact Verification Agent. 
        Analyze the provided scraped content against the user's original query and intent.
        Extract relevant facts about internships (Role, Company, Location, Eligibility, Batch, Application Link).
        For each fact, assign a confidence level (High, Medium, Low) and cite the source URL.
        
        Output a JSON list of objects with keys: topic, claim, source_url, confidence, reasoning.
        """

        prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            ("human", "User Query: {query}\nIntent: {intent}\n\nContext:\n{context}")
        ])

        chain = prompt | self.llm | self.parser
        
        try:
            facts = chain.invoke({
                "query": state["query"],
                "intent": str(intent),
                "context": context_str,
            })
            
            # Ensure it's a list
            if not isinstance(facts, list):
                facts = [facts]
                
            log = {
                "step": "VerificationAgent",
                "action": "Verified Facts",
                "details": {"facts_count": len(facts)}
            }
            
            return {
                "verified_facts": facts,
                "execution_log": [log]
            }
            
        except Exception as e:
            print(f"Verification Agent Error: {e}")
            return {
                "errors": [str(e)],
                "execution_log": [{"step": "VerificationAgent", "error": str(e)}]
            }
