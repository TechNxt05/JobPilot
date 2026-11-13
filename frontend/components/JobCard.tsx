"use client";

import { apiFetch } from "@/lib/api";
import React, { useState } from 'react';
import { Card, Button } from '@/components/ui';
import { Briefcase, MapPin, DollarSign, ExternalLink, CheckCircle, XCircle, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

interface Job {
  role: string;
  company: string;
  location: string;
  type: string;
  stipend: string;
  description: string;
  skills_required: string[];
  apply_link: string;
}

interface MatchResult {
  score: number;
  match_level: string;
  missing_keywords: string[];
  strengths: string[];
  weaknesses: string[];
  improvement_tips: string[];
}

interface JobCardProps {
  job: Job;
  resumeText: string; // We need resume text to perform match
}

export const JobCard: React.FC<JobCardProps> = ({ job, resumeText }) => {
  const [expanded, setExpanded] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);

  const handleAnalyze = async () => {
    if (!resumeText) {
      alert("Please upload your resume in the Profile section first!");
      return;
    }
    setAnalyzing(true);
    setExpanded(true);
    try {
      const res = await apiFetch(`/jobs/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resume_text: resumeText,
          job_description: `${job.role} at ${job.company}. ${job.description}. Skills: ${job.skills_required.join(", ")}`
        })
      });
      const data = await res.json();
      setMatchResult(data);
    } catch (e) {
      console.error(e);
      alert("Failed to analyze match.");
    } finally {
      setAnalyzing(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-ok";
    if (score >= 50) return "text-warn";
    return "text-destructive";
  };

  return (
    <Card className="p-4">
      <div className="flex justify-between items-start">
        <div>
          <h3 className="font-bold text-lg">{job.role}</h3>
          <p className="text-muted-foreground font-medium">{job.company}</p>
        </div>
        {matchResult && (
          <div className={`px-3 py-1 rounded-[3px] border text-sm font-bold ${getScoreColor(matchResult.score)}`}>
            {matchResult.score}% Match
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-4 mt-3 text-sm text-muted-foreground">
        <div className="flex items-center gap-1">
          <MapPin size={14} /> {job.location}
        </div>
        <div className="flex items-center gap-1">
          <Briefcase size={14} /> {job.type}
        </div>
        <div className="flex items-center gap-1">
          <DollarSign size={14} /> {job.stipend}
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <a href={job.apply_link} target="_blank" rel="noopener noreferrer">
          <Button size="sm" className="gap-2">
            Apply Now <ExternalLink size={14} />
          </Button>
        </a>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={handleAnalyze} 
          disabled={analyzing}
        >
          {analyzing ? <Loader2 className="animate-spin" size={14} /> : "Analyze Match"}
        </Button>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </Button>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-border space-y-4">
          <div>
            <h4 className="font-semibold text-sm mb-1">Description</h4>
            <p className="text-sm text-muted-foreground">{job.description}</p>
          </div>
          
          <div>
            <h4 className="font-semibold text-sm mb-1">Skills Required</h4>
            <div className="flex flex-wrap gap-1">
              {job.skills_required.map((skill, i) => (
                <span key={i} className="text-xs chip px-2 py-1 rounded-[3px]">
                  {skill}
                </span>
              ))}
            </div>
          </div>

          {matchResult && (
            <div className="bg-slate-50 p-3 rounded-[3px] space-y-3">
              <div>
                <h4 className="font-semibold text-sm text-ok flex items-center gap-1">
                  <CheckCircle size={14} /> Strengths
                </h4>
                <ul className="list-disc list-inside text-xs text-muted-foreground">
                  {matchResult.strengths.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
              
              <div>
                <h4 className="font-semibold text-sm text-destructive flex items-center gap-1">
                  <XCircle size={14} /> Missing Skills
                </h4>
                <div className="flex flex-wrap gap-1 mt-1">
                    {matchResult.missing_keywords.map((k, i) => (
                        <span key={i} className="text-xs text-destructive px-2 py-0.5 rounded border">
                            {k}
                        </span>
                    ))}
                </div>
              </div>

              <div>
                 <h4 className="font-semibold text-sm text-primary mb-1">💡 Improvement Tips</h4>
                 <ul className="list-disc list-inside text-xs text-muted-foreground">
                  {matchResult.improvement_tips.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
};
