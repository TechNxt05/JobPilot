"use client";

import { apiFetch } from "@/lib/api";
import { latestResumeText } from "@/lib/data";
import React, { useState, useEffect } from 'react';
import { Button, Card, Input } from '@/components/ui';
import { Loader2, AlertTriangle, CheckCircle, Lightbulb, FileText, ArrowRight } from 'lucide-react';
import Link from 'next/link';

interface ScoreResult {
    score: number;
    summary: string;
    critical_issues: string[];
    formatting_issues: string[];
    content_strengths: string[];
    improvement_plan: string[];
}

export default function ResumeScorePage() {
    const [loading, setLoading] = useState(false);
    const [resumeText, setResumeText] = useState("");
    const [result, setResult] = useState<ScoreResult | null>(null);

    // Resume text for matching: latest resume from your Supabase profile (shared with the extension)
    useEffect(() => {
        latestResumeText().then(setResumeText).catch((e) => console.error("Resume load error", e));
    }, []);

    const handleAnalyze = async () => {
        if (!resumeText) return;
        setLoading(true);
        try {
            const res = await apiFetch(`/resume/score`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ resume_text: resumeText })
            });
            const data = await res.json();
            setResult(data);
        } catch (e) {
            console.error(e);
            alert("Failed to analyze resume");
        } finally {
            setLoading(false);
        }
    };

    const getScoreColor = (score: number) => {
        if (score >= 80) return "text-ok";
        if (score >= 50) return "text-warn";
        return "text-destructive";
    };

    return (
        <div className="container mx-auto p-6 max-w-4xl">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-4xl">Resume Health Check</h1>
                    <p className="text-muted-foreground">Detailed ATS analysis and improvement tips.</p>
                </div>
                <div className="flex gap-2">
                    <Link href="/internships">
                        <Button variant="ghost">Find Jobs</Button>
                    </Link>
                    <Link href="/profile">
                        <Button variant="outline">Profile</Button>
                    </Link>
                </div>
            </div>

            {/* Controls */}
            {!result && (
                <Card className="p-8 text-center space-y-4">
                    <FileText size={48} className="mx-auto text-primary" />
                    <h2 className="text-xl font-semibold">Ready to analyze your resume?</h2>
                    <p className="text-muted-foreground max-w-md mx-auto">
                        We will scan your resume for ATS compatibility, keyword density, and formatting issues.
                    </p>
                    <Button size="lg" onClick={handleAnalyze} disabled={loading || !resumeText}>
                        {loading ? <Loader2 className="animate-spin mr-2" /> : "Start Analysis"}
                    </Button>
                    {!resumeText && <p className="text-destructive text-sm">No resume found. Upload one in Profile (or in the JobPilot browser extension).</p>}
                </Card>
            )}

            {result && (
                <div className="space-y-8">
                    {/* Score Section */}
                    <div className="flex flex-col md:flex-row gap-8 items-center justify-center p-8 bg-card rounded-[3px] border">
                        <div className="relative w-40 h-40 flex items-center justify-center">
                            <svg className="w-full h-full transform -rotate-90">
                                <circle cx="80" cy="80" r="70" stroke="currentColor" strokeWidth="10" fill="transparent" className="text-muted-foreground" />
                                <circle cx="80" cy="80" r="70" stroke="currentColor" strokeWidth="10" fill="transparent"
                                    strokeDasharray={440}
                                    strokeDashoffset={440 - (440 * result.score) / 100}
                                    className={`${getScoreColor(result.score)} transition-all duration-1000 ease-out`}
                                />
                            </svg>
                            <span className={`absolute text-4xl font-bold ${getScoreColor(result.score).split(' ')[0]}`}>{result.score}</span>
                        </div>
                        <div className="flex-1 space-y-2">
                            <h2 className="text-2xl font-bold">Overall Assessment</h2>
                            <p className="text-muted-foreground text-lg">{result.summary}</p>
                        </div>
                        <Button variant="outline" onClick={() => setResult(null)}>Re-Analyze</Button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Critical Issues */}
                        <Card className="p-6">
                            <h3 className="font-semibold text-destructive flex items-center gap-2 mb-4">
                                <AlertTriangle size={20} /> Critical Issues
                            </h3>
                            <ul className="space-y-2">
                                {result.critical_issues.map((issue, i) => (
                                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                                        <span className="text-destructive mt-1">•</span> {issue}
                                    </li>
                                ))}
                            </ul>
                        </Card>

                        {/* Strengths */}
                        <Card className="p-6">
                            <h3 className="font-semibold text-ok flex items-center gap-2 mb-4">
                                <CheckCircle size={20} /> Strengths
                            </h3>
                            <ul className="space-y-2">
                                {result.content_strengths.map((str, i) => (
                                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                                        <span className="text-ok mt-1">•</span> {str}
                                    </li>
                                ))}
                            </ul>
                        </Card>
                    </div>

                    {/* Improvement Plan */}
                    <Card className="p-6 bg-card">
                        <h3 className="font-semibold text-primary flex items-center gap-2 mb-4">
                            <Lightbulb size={20} /> Action Plan
                        </h3>
                        <div className="grid grid-cols-1 gap-4">
                            {result.improvement_plan.map((step, i) => (
                                <div key={i} className="flex items-center gap-4 bg-card p-3 rounded border border-border">
                                    <span className="w-8 h-8 rounded-[3px] text-primary flex items-center justify-center font-bold flex-shrink-0">
                                        {i + 1}
                                    </span>
                                    <span className="text-sm font-medium text-muted-foreground">{step}</span>
                                </div>
                            ))}
                        </div>
                    </Card>

                    {/* Formatting */}
                    {result.formatting_issues.length > 0 && (
                        <Card className="p-6">
                            <h3 className="font-semibold text-muted-foreground mb-4">Formatting & ATS Check</h3>
                            <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                {result.formatting_issues.map((issue, i) => (
                                    <li key={i} className="text-sm text-muted-foreground flex items-center gap-2">
                                        <AlertTriangle size={14} className="text-warn" /> {issue}
                                    </li>
                                ))}
                            </ul>
                        </Card>
                    )}
                </div>
            )}
        </div>
    );
}
