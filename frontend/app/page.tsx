"use client";

import { apiFetch } from "@/lib/api";
import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Send, Bot, User, Globe, Briefcase, Users, Link as LinkIcon, AlertTriangle } from 'lucide-react';
import { Button, Input, Card } from '@/components/ui';
import { FlowVisualizer } from '@/components/FlowVisualizer';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  discovery?: any; // To store discovery data
}

interface LogEntry {
  step: number;
  agent: string;
  action: string;
  details?: any;
  status: 'pending' | 'active' | 'completed' | 'error';
}

export default function Home() {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [flowSteps, setFlowSteps] = useState<LogEntry[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, flowSteps]);

  const handleSend = async () => {
    if (!query.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: query };
    setMessages(prev => [...prev, userMessage]);
    const currentQuery = query;
    setQuery('');
    setIsLoading(true);
    setFlowSteps([]); // Reset flow for new query

    try {
      const response = await apiFetch(`/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: currentQuery })
      });

      if (!response.ok || !response.body) throw new Error(`Chat request failed (${response.status})`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantMessage = "";
      let discoveryData = null; // Store temp discovery data
      let autofillData = null;
      let stepCount = 0;

      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // A network chunk can end mid-event: keep the trailing partial line for the next read
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const jsonStr = line.replace("data: ", "");
              const data = JSON.parse(jsonStr);

              // Check for errors
              if (data.error) {
                setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${data.error}` }]);
                setIsLoading(false);
                return;
              }

              // Process Node Output
              // Data is like { "search": { "execution_log": [...], "search_results": ... } }
              const nodeName = Object.keys(data)[0];
              const nodeData = data[nodeName];

              if (nodeData.execution_log) {
                const logs: any[] = nodeData.execution_log;
                logs.forEach(log => {
                  stepCount++;
                  setFlowSteps(prev => {
                    // Check if step exists? No, just append
                    return [...prev, {
                      step: stepCount,
                      agent: log.step || nodeName, // Agent name
                      action: log.action || "Processing",
                      details: log.details,
                      status: 'completed'
                    }];
                  });
                });
              }

              if (nodeData.discovery_data) {
                discoveryData = nodeData.discovery_data;
              }
              if (nodeData.autofill_analysis) {
                autofillData = nodeData.autofill_analysis;
              }

              if (nodeData.final_answer) {
                assistantMessage = nodeData.final_answer;
              }

            } catch (e) {
              console.error("Error parsing stream line", e);
            }
          }
        }
      }

      // Append final message with discovery data
      if (assistantMessage) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: assistantMessage,
          discovery: { ...discoveryData, autofill: autofillData }
        }]);
      }

    } catch (error) {
      console.error("Chat error:", error);
      setMessages(prev => [...prev, { role: 'assistant', content: "An error occurred while connecting to the server." }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden font-sans">
      {/* Sidebar / Visualizer Panel */}
      <div className="w-1/3 h-full border-r border-border hidden md:block">
        <FlowVisualizer steps={flowSteps} />
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col h-full relative">
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-50">
              <Bot size={48} className="mb-4" />
              <p className="text-lg font-medium">Internship Intelligence</p>
              <p className="text-sm">Ask about internships, roles, and eligibility.</p>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`flex gap-3 max-w-[80%] ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
                  }`}>
                  {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                </div>
                <Card className={`p-4 ${msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card'
                  }`}>
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>

                  {/* Deep Dive Cards */}
                  {msg.discovery && (
                    <div className="mt-4 pt-4 border-t border-border space-y-3">
                      <h4 className="font-semibold text-sm flex items-center gap-2">
                        <Globe className="w-4 h-4 text-blue-500" />
                        Internship Intelligence
                      </h4>

                      {msg.discovery.apply_links && msg.discovery.apply_links.length > 0 && (
                        <div className="grid grid-cols-1 gap-2">
                          {msg.discovery.apply_links.map((link: any, i: number) => (
                            <div key={i} className="flex items-center justify-between p-2 bg-muted/30 rounded border border-border">
                              <span className="text-xs truncate max-w-[200px]">{link.title}</span>
                              <a href={link.link} target="_blank" rel="noopener noreferrer">
                                <Button size="sm" variant="outline" className="h-7 text-xs">Apply Now</Button>
                              </a>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* People / Recruiters */}
                      {msg.discovery.people && msg.discovery.people.length > 0 && (
                        <div className="space-y-1">
                          <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                            <Users className="w-3 h-3" /> Relevant People
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {msg.discovery.people.map((p: any, i: number) => (
                              <a key={i} href={p.link} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline bg-blue-50 px-2 py-1 rounded">
                                {(p.title || p.link).split(' - ')[0]}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Autofill Status */}
                      {msg.discovery.autofill && msg.discovery.autofill.length > 0 && (
                        <div className="bg-orange-50/50 p-2 rounded border border-orange-100">
                          <span className="text-xs font-semibold text-orange-700 flex items-center gap-1 mb-1">
                            <Briefcase className="w-3 h-3" /> Application Autofill
                          </span>
                          {msg.discovery.autofill.map((auto: any, i: number) => (
                            <div key={i} className="flex justify-between items-center text-xs mt-1">
                              <span className="truncate max-w-[150px] text-muted-foreground">{(() => { try { return new URL(auto.url).hostname; } catch { return auto.url; } })()}</span>
                              <span className={`px-1.5 py-0.5 rounded ${auto.status === 'Supported' ? 'bg-green-100 text-green-700' :
                                auto.status === 'Partial' ? 'bg-yellow-100 text-yellow-700' :
                                  'bg-gray-100 text-gray-500'
                                }`}>
                                {auto.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              </div>
            </div>
          ))}

          {/* Loading Indicator */}
          {isLoading && !messages[messages.length - 1]?.content && (
            <div className="flex justify-start">
              <div className="flex gap-3 max-w-[80%]">
                <div className="w-8 h-8 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center">
                  <Bot size={16} />
                </div>
                <Card className="p-4 bg-card">
                  <div className="flex items-center gap-2">
                    <span className="animate-pulse">Thinking...</span>
                  </div>
                </Card>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-border bg-background">
          <div className="flex gap-2 max-w-4xl mx-auto">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Ask about internships..."
              className="flex-1"
              disabled={isLoading}
            />
            <Button onClick={handleSend} disabled={isLoading || !query.trim()}>
              <Send size={18} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
