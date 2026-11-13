"use client"

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, Search, FileText, ShieldCheck, Award, MessageSquare, Activity, Loader2 } from 'lucide-react';
import { cn } from './ui';

interface FlowStep {
    step: number;
    agent: string;
    action?: string;
    details?: unknown;
    status: 'pending' | 'active' | 'completed' | 'error';
}

const AgentIcon = ({ agent }: { agent: string }) => {
    const c = "w-4 h-4";
    if (agent.includes('Query')) return <Search className={c} aria-hidden />;
    if (agent.includes('Search')) return <Activity className={c} aria-hidden />;
    if (agent.includes('Scraper')) return <FileText className={c} aria-hidden />;
    if (agent.includes('Verification')) return <ShieldCheck className={c} aria-hidden />;
    if (agent.includes('Ranking')) return <Award className={c} aria-hidden />;
    if (agent.includes('Answer')) return <MessageSquare className={c} aria-hidden />;
    return <CheckCircle className={c} aria-hidden />;
};

const STATUS: Record<FlowStep['status'], { label: string; cls: string }> = {
    pending: { label: 'Waiting', cls: 'border-input text-muted-foreground' },
    active: { label: 'Running', cls: 'bg-primary border-primary text-primary-foreground' },
    completed: { label: 'Done', cls: 'bg-ok border-ok text-white dark:text-[#0b1220]' },
    error: { label: 'Failed', cls: 'bg-destructive border-destructive text-destructive-foreground' },
};

/** The agent's run, drawn as a chart: one ruled row per step with its status tag. */
export function FlowVisualizer({ steps }: { steps: FlowStep[] }) {
    return (
        <div className="flex h-full w-full flex-col bg-card">
            <div className="band-head">
                <span>Execution flow</span>
                <span className="fig font-normal normal-case tracking-normal text-muted-foreground">{steps.length ? `${steps.length} steps` : ''}</span>
            </div>
            <div className="flex-1 overflow-y-auto">
                {steps.length === 0 && (
                    <p className="px-4 py-6 text-sm text-muted-foreground">Each step the agent takes (understand the question, search, read pages, verify, rank, answer) appears here as it runs.</p>
                )}
                <AnimatePresence initial={false}>
                    {steps.map((step, idx) => (
                        <motion.div
                            key={idx}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                            className="band-row px-4 py-3"
                        >
                            <div className="flex items-start gap-3">
                                <span className="fig mt-0.5 w-6 shrink-0 text-muted-foreground">{String(step.step).padStart(2, '0')}</span>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-2">
                                        <h4 className="flex items-center gap-1.5 font-narrow text-[15px] font-semibold tracking-[0.02em]">
                                            <AgentIcon agent={step.agent} /> {step.agent}
                                        </h4>
                                        <span className={cn("fig inline-flex items-center gap-1 border px-1.5 py-[2px] text-[11px] uppercase leading-none", STATUS[step.status].cls)}>
                                            {step.status === 'active' && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                                            {STATUS[step.status].label}
                                        </span>
                                    </div>
                                    <p className="mt-1 text-[13px] text-muted-foreground">{step.action || "Processing…"}</p>
                                    {step.details != null && (
                                        <details className="mt-2">
                                            <summary className="label cursor-pointer">Details</summary>
                                            <pre className="fig mt-1 max-h-48 overflow-auto whitespace-pre-wrap border border-border bg-background p-2 text-[11px]">
                                                {JSON.stringify(step.details, null, 2)}
                                            </pre>
                                        </details>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </div>
    );
}
