"use client";

import { apiFetch } from "@/lib/api";
import { latestResumeText } from "@/lib/data";
import React, { useState, useEffect } from 'react';
import { Button, Input } from '@/components/ui';
import { JobCard } from '@/components/JobCard';
import { Search, Loader2 } from 'lucide-react';
import Link from 'next/link';

export default function InternshipsPage() {
    const [role, setRole] = useState("");
    const [location, setLocation] = useState("");
    const [loading, setLoading] = useState(false);
    const [jobs, setJobs] = useState<any[]>([]);
    const [resumeText, setResumeText] = useState("");

    // Resume text for matching: latest resume from your Supabase profile (shared with the extension)
    useEffect(() => {
        latestResumeText().then(setResumeText).catch((e) => console.error("Resume load error", e));
    }, []);

    const handleSearch = async () => {
        if (!role || !location) return;
        setLoading(true);
        setJobs([]);
        try {
            const res = await apiFetch(`/jobs/search`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ role, location })
            });
            const data = await res.json();
            setJobs(data.jobs || []);
        } catch (e) {
            console.error("Search failed", e);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="container mx-auto p-6 max-w-5xl">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold">Internship Board</h1>
                    <p className="text-muted-foreground">Find and analyze the best opportunities for you.</p>
                </div>
                <div className="flex gap-2">
                    <Link href="/">
                        <Button variant="ghost">Chat</Button>
                    </Link>
                    <Link href="/profile">
                        <Button variant="outline">Profile</Button>
                    </Link>
                </div>
            </div>

            {/* Search Bar */}
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100 flex flex-col md:flex-row gap-4 mb-8">
                <div className="flex-1">
                    <label className="text-sm font-medium mb-1 block">Role</label>
                    <Input
                        placeholder="e.g. Frontend Developer, Data Scientist"
                        value={role}
                        onChange={e => setRole(e.target.value)}
                    />
                </div>
                <div className="flex-1">
                    <label className="text-sm font-medium mb-1 block">Location</label>
                    <Input
                        placeholder="e.g. Remote, Bangalore, New York"
                        value={location}
                        onChange={e => setLocation(e.target.value)}
                    />
                </div>
                <div className="flex items-end">
                    <Button onClick={handleSearch} disabled={loading || !role || !location} className="w-full md:w-auto">
                        {loading ? <Loader2 className="animate-spin mr-2" /> : <Search className="mr-2" size={18} />}
                        Find Jobs
                    </Button>
                </div>
            </div>

            {/* Results */}
            <div className="space-y-6">
                {jobs.length > 0 ? (
                    <div className="grid grid-cols-1 gap-4">
                        {jobs.map((job, idx) => (
                            <JobCard key={idx} job={job} resumeText={resumeText} />
                        ))}
                    </div>
                ) : (
                    !loading && (
                        <div className="text-center text-gray-500 py-12">
                            <p>No jobs found yet. Start a search!</p>
                        </div>
                    )
                )}
            </div>
        </div>
    );
}
