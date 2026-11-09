from typing import Dict, Any
from app.graph.state import AgentState

class AutofillAgent:
    def run(self, state: AgentState) -> Dict[str, Any]:
        print("--- AUTOFILL AGENT ---")
        # In a real scenario, this would trigger Playwright to analyze a specific form URL.
        # For this chat flow, we primarily Explain what we *could* do or detect if a link is autofillable.
        
        discovery_data = state.get("discovery_data") or {}
        apply_links = discovery_data.get("apply_links") or []
        
        autofill_status = []
        
        for link_obj in apply_links:
            url = link_obj.get("link", "")
            status = "Not Supported"
            reason = "Unknown form type"
            
            if "google.com/forms" in url:
                status = "Supported"
                reason = "Google Form detected"
            elif "linkedin.com/jobs" in url:
                 status = "Manual"
                 reason = "Login required (LinkedIn)"
            elif "workday" in url or "taleo" in url:
                 status = "Partial"
                 reason = "Complex ATS detected"
            else:
                 status = "Experimental"
                 reason = "Standard HTML form analysis required"
                 
            autofill_status.append({
                "url": url,
                "status": status,
                "reason": reason
            })
            
        log = {
            "step": "AutofillAgent",
            "action": "Analyzed Form Compatibility",
            "details": autofill_status
        }
        
        return {
            "autofill_analysis": autofill_status,
            "execution_log": [log]
        }
