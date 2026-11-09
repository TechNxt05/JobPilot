from typing import Dict, Any, List
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser
from app.core.llm import LLMFactory
import json

class JobMatcher:
    def __init__(self):
        self.llm = LLMFactory.get_llm(provider="groq")
        self.parser = JsonOutputParser()

    async def match_resume_to_job(self, resume_text: str, job_description: str) -> Dict[str, Any]:
        """
        Compare resume against job description to calculate a match score.
        """
        try:
            prompt = ChatPromptTemplate.from_template(
                """
                You are an expert ATS (Applicant Tracking System) and Career Coach.
                Compare the candidate's resume with the job description.
                
                Resume:
                {resume_text}
                
                Job Description:
                {job_description}
                
                Analyze the match based on skills, experience, and keywords.
                
                Output detailed JSON:
                {{
                    "score": <integer 0-100>,
                    "match_level": "High" (80+), "Medium" (50-79), or "Low" (<50),
                    "missing_keywords": ["keyword1", "keyword2"],
                    "strengths": ["Matched Skill A", "Good Experience in B"],
                    "weaknesses": ["Missing critical skill X", "Not enough years in Y"],
                    "improvement_tips": ["Add project using X", "Quantify impact in Y"]
                }}
                """
            )
            
            chain = prompt | self.llm | self.parser
            
            result = await chain.ainvoke({
                "resume_text": resume_text[:6000],
                "job_description": job_description[:3000]
            })
            
            return result
        except Exception as e:
            print(f"Match calculation error: {e}")
            return {
                "score": 0,
                "match_level": "Error",
                "missing_keywords": [],
                "strengths": [],
                "weaknesses": [],
                "improvement_tips": ["Could not analyze match."]
            }
