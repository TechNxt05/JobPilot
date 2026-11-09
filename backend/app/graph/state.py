import operator
from typing import Annotated, TypedDict, List, Dict, Any, Optional


class AgentState(TypedDict, total=False):
    query: str
    user_id: Optional[str]  # Supabase user id (from the verified token)
    access_token: Optional[str]  # User's Supabase token: profile is read as the user, so RLS applies
    user_context: Optional[str]  # From ProfileAgent
    intent: Optional[Dict[str, Any]]
    search_results: Optional[List[Dict[str, Any]]]
    discovery_data: Optional[Dict[str, Any]]  # Apply links, people
    autofill_analysis: Optional[List[Dict[str, Any]]]
    scraped_content: Optional[List[Dict[str, Any]]]
    verified_facts: Optional[List[Dict[str, Any]]]
    final_answer: Optional[str]
    # Reducers: each node's entries are appended instead of overwriting earlier ones
    execution_log: Annotated[List[Dict[str, Any]], operator.add]
    errors: Annotated[List[str], operator.add]
    # Numbered, UI-ready version of execution_log (written by VisualizerAgent)
    execution_flow: Optional[List[Dict[str, Any]]]
