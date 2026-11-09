from typing import Dict, Any
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from app.core.llm import LLMFactory
from app.graph.state import AgentState

class AnswerAgent:
    def __init__(self):
        self.llm = LLMFactory.get_llm(provider="groq")
        self.parser = StrOutputParser()

    def run(self, state: AgentState) -> Dict[str, Any]:
        print("--- ANSWER AGENT ---")
        verified_facts = state.get("verified_facts") or []
        
        facts_str = ""
        for fact in verified_facts:
            facts_str += f"- {fact.get('claim')} (Source: {fact.get('source_url')})\n"
            
        system_prompt = """You are an Internship Intelligence Expert. 
        Synthesize the verified facts into a final answer for the user.
        Follow this strict format:
        
        ### ✅ Answer
        (Direct answer to the query)

        ### 📋 Key Details
        (Bullet points or table of roles, eligibility, etc.)

        ### ⚠️ Notes
        (Any uncertainties or conflicting info)

        ### 📊 Confidence
        (Overall confidence: High/Medium/Low based on facts)

        ### 📚 Sources
        (Numbered list of unique source URLs)
        
        Do not make up information. If no facts found, state that no confirmed information is available.
        """

        prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            ("human", "User Query: {query}\nVerified Facts:\n{facts}")
        ])

        chain = prompt | self.llm | self.parser
        
        try:
            answer = chain.invoke({"query": state["query"], "facts": facts_str})
            
            log = {
                "step": "AnswerAgent",
                "action": "Generated Answer",
                "details": {"length": len(answer)}
            }
            
            return {
                "final_answer": answer,
                "execution_log": [log]
            }
        except Exception as e:
             return {
                "errors": [str(e)],
                "execution_log": [{"step": "AnswerAgent", "error": str(e)}]
            }
