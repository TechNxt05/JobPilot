from typing import Dict, Any, List
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser
from app.core.llm import LLMFactory
import json

class ResumeScorerAgent:
    def __init__(self):
        self.llm = LLMFactory.get_llm(provider="groq")
        self.parser = JsonOutputParser()

    async def score_resume(self, resume_text: str) -> Dict[str, Any]:
        """
        Analyze resume for ATS compatibility and content quality.
        """
        try:
            prompt = ChatPromptTemplate.from_template(
                """
                You are an expert Resume Reviewer and ATS (Applicant Tracking System) Auditor.
                Analyze the following resume text.
                
                Resume:
                {resume_text}
                
                Provide a structured audit of the resume.
                
                Output JSON:
                {{
                    "score": <integer 0-100>,
                    "summary": "1-2 sentence overall assessment",
                    "critical_issues": ["Repo link broken", "Missing phone number", "No measurable impact in projects"],
                    "formatting_issues": ["Date format inconsistent", "Too much dense text", "Avoid using columns if parsing failed"],
                    "content_strengths": ["Strong action verbs", "Good technical skills section"],
                    "improvement_plan": [
                        "Action 1: Add metrics to 'Work Experience'", 
                        "Action 2: Rename 'Hobbies' to 'Interests'"
                    ]
                }}
                
                Be strict but constructive.
                """
            )
            
            chain = prompt | self.llm | self.parser
            
            result = await chain.ainvoke({
                "resume_text": resume_text[:10000]
            })
            
            return result
        except Exception as e:
            print(f"Scoring calculation error: {e}")
            return {
                "score": 0,
                "summary": "Error analyzing resume.",
                "critical_issues": ["Analysis failed"],
                "formatting_issues": [],
                "content_strengths": [],
                "improvement_plan": []
            }
