"use client"

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, Search, FileText, ShieldCheck, Award, MessageSquare, Activity } from 'lucide-react';
import { Card } from './ui';

interface FlowStep {
    step: number;
    agent: string;
    action?: string;
    details?: any;
    status: 'pending' | 'active' | 'completed' | 'error';
}

const AgentIcon = ({ agent }: { agent: string }) => {
    if (agent.includes('Query')) return <Search className="w-5 h-5" />;
    if (agent.includes('Search')) return <Activity className="w-5 h-5" />; // Or specific icon
    if (agent.includes('Scraper')) return <FileText className="w-5 h-5" />;
    if (agent.includes('Verification')) return <ShieldCheck className="w-5 h-5" />;
    if (agent.includes('Ranking')) return <Award className="w-5 h-5" />;
    if (agent.includes('Answer')) return <MessageSquare className="w-5 h-5" />;
    return <CheckCircle className="w-5 h-5" />;
};

export function FlowVisualizer({ steps }: { steps: FlowStep[] }) {
    return (
        <div className="w-full h-full p-4 border-l border-border bg-muted/20 overflow-y-auto">
            <h3 className="font-semibold mb-4 text-lg">Execution Flow</h3>
            <div className="space-y-4">
                <AnimatePresence>
                    {steps.map((step, idx) => (
                        <motion.div
                            key={idx}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.3 }}
                        >
                            <Card className={`p-3 border-l-4 ${step.status === 'active' ? 'border-l-blue-500 bg-blue-50/10' :
                                    step.status === 'completed' ? 'border-l-green-500' : 'border-l-gray-300'
                                }`}>
                                <div className="flex items-start gap-3">
                                    <div className={`p-2 rounded-full ${step.status === 'active' ? 'bg-blue-100 text-blue-600' :
                                            step.status === 'completed' ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'
                                        }`}>
                                        <AgentIcon agent={step.agent} />
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex justify-between items-center">
                                            <h4 className="font-medium text-sm">{step.agent}</h4>
                                            <span className="text-xs text-muted-foreground">Step {step.step}</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-1">{step.action || "Processing..."}</p>

                                        {step.details && (
                                            <div className="mt-2 text-xs bg-muted/50 p-2 rounded overflow-x-auto whitespace-pre-wrap font-mono">
                                                {JSON.stringify(step.details, null, 2)}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </Card>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </div>
    );
}
