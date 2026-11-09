from langgraph.graph import StateGraph, END
from app.graph.state import AgentState
from app.agents.query_agent import QueryAgent
from app.agents.search_agent import SearchAgent
from app.agents.scraper_agent import ScraperAgent
from app.agents.verification_agent import VerificationAgent
from app.agents.ranking_agent import RankingAgent
from app.agents.answer_agent import AnswerAgent
from app.agents.visualizer_agent import VisualizerAgent
from app.agents.profile_agent import ProfileContextAgent
from app.agents.discovery_agent import DiscoveryAgent
from app.agents.autofill_agent import AutofillAgent

def create_graph():
    workflow = StateGraph(AgentState)

    # Initialize Agents
    profile_agent = ProfileContextAgent()
    query_agent = QueryAgent()
    search_agent = SearchAgent()
    discovery_agent = DiscoveryAgent()
    scraper_agent = ScraperAgent()
    verification_agent = VerificationAgent()
    ranking_agent = RankingAgent()
    autofill_agent = AutofillAgent()
    answer_agent = AnswerAgent()
    visualizer_agent = VisualizerAgent()

    # Add Nodes
    workflow.add_node("profile", profile_agent.run)
    workflow.add_node("query_analysis", query_agent.run)  # node names must not clash with state keys
    workflow.add_node("search", search_agent.run)
    workflow.add_node("discovery", discovery_agent.run)
    workflow.add_node("scraper", scraper_agent.run)
    workflow.add_node("verification", verification_agent.run)
    workflow.add_node("ranking", ranking_agent.run)
    workflow.add_node("autofill", autofill_agent.run)
    workflow.add_node("answer", answer_agent.run)
    workflow.add_node("visualizer", visualizer_agent.run)

    # Define Edges
    workflow.set_entry_point("profile")
    workflow.add_edge("profile", "query_analysis")
    workflow.add_edge("query_analysis", "search")
    
    # Run Discovery Parallel to Scraper? Or Sequentially?
    # Let's run Scraper -> Verification -> Discovery -> Autofill -> Ranking -> Answer
    # Or Search -> (Scraper, Discovery) -> ...
    # For simplicity, let's keep it sequential or branching.
    # Search -> Scraper
    # Search -> Discovery (We can use search results or do new search)
    
    workflow.add_edge("search", "scraper")
    workflow.add_edge("scraper", "verification")
    workflow.add_edge("verification", "discovery")
    workflow.add_edge("discovery", "autofill")
    workflow.add_edge("autofill", "ranking")
    workflow.add_edge("ranking", "answer")
    workflow.add_edge("answer", "visualizer")
    workflow.add_edge("visualizer", END)

    return workflow.compile()

app_graph = create_graph()
