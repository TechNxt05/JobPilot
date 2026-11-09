from typing import Dict, Any, List
from app.graph.state import AgentState

class VisualizerAgent:
    def run(self, state: AgentState) -> Dict[str, Any]:
        """
        Consolidates execution logs into the final structured metadata format required by the frontend.
        """
        print("--- VISUALIZER AGENT ---")
        logs = state.get("execution_log") or []
        
        # We can reformat or clean up logs here if needed.
        # The prompt requires:
        # { "execution_flow": [ { "step": 1, "agent": "QueryAgent", ... } ] }
        
        formatted_flow = []
        for i, log in enumerate(logs):
            formatted_flow.append({
                "step": i + 1,
                "agent": log.get("step"),
                "details": log.get("details", {}),
                "action": log.get("action"),
                "error": log.get("error")
            })
            
        # We don't overwrite the state, just ensure it's ready for the API response.
        # Actually, let's store it in a specific key if needed, or just rely on execution_log.
        # But the API will likely return the full state or a subset.
        
        return {
            # Separate key: execution_log has an append reducer, so returning it would duplicate entries
            "execution_flow": formatted_flow
        }
