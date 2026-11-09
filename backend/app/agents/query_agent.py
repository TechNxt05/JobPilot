from typing import Dict, Any
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import PydanticOutputParser
from app.core.llm import LLMFactory
from app.graph.state import AgentState
from app.core.schemas import UserIntent

class QueryAgent:
    def __init__(self):
        self.llm = LLMFactory.get_llm(provider="groq")
        self.parser = PydanticOutputParser(pydantic_object=UserIntent)

    def run(self, state: AgentState) -> Dict[str, Any]:
        print("--- QUERY AGENT ---")
        query = state["query"]

        system_prompt = """You are an expert Internship Search Assistant. 
        Analyze the user's query and extract the key information.
        Generate specific search queries that will help find the answer.
        Focus on finding official career pages, eligibility criteria, and application links.
        
        {format_instructions}
        """

        prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt),
            ("human", "{query}")
        ])

        chain = prompt | self.llm | self.parser
        
        try:
            intent: UserIntent = chain.invoke({
                "query": query,
                "format_instructions": self.parser.get_format_instructions()
            })
            
            # Log execution
            log = {
                "step": "QueryAgent",
                "action": "Extracted Intent",
                "details": intent.model_dump()
            }
            
            return {
                "intent": intent.model_dump(),
                "execution_log": [log]
            }
        except Exception as e:
            print(f"Query Agent Error: {e}")
            return {
                "errors": [str(e)],
                "execution_log": [{"step": "QueryAgent", "error": str(e)}]
            }
