'use client';

import { useState, useEffect, useCallback } from 'react';
import { Activity, RefreshCw, CheckCircle2, XCircle, Clock, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface QueuedJob {
  id: number;
  jobType: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  runAfter: string;
  createdAt: string;
}

interface CronRun {
  id: number;
  jobName: string;
  status: 'success' | 'failed';
  detail: string | null;
  durationMs: number | null;
  startedAt: string;
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  processing: 'bg-blue-100 text-blue-700',
  failed: 'bg-red-100 text-red-700',
  completed: 'bg-green-100 text-green-700',
};

const formatDateTime = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

export default function SystemJobsPage() {
  const { token } = useAuth();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [jobs, setJobs] = useState<QueuedJob[]>([]);
  const [cronRuns, setCronRuns] = useState<CronRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/system-jobs', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = await res.json();
      if (res.ok) {
        setCounts(data.jobQueue?.counts || {});
        setJobs(data.jobQueue?.recent || []);
        setCronRuns(data.cronRuns || []);
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleRetry = async (jobId: number) => {
    setRetryingId(jobId);
    setMsg('');
    try {
      const res = await fetch('/api/system-jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ jobId }),
      });
      if (res.ok) {
        setMsg(`Job #${jobId} queued for retry.`);
        load();
      } else {
        const data = await res.json().catch(() => ({}));
        setMsg(data.error || 'Failed to retry job');
      }
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Activity className="h-5 w-5 text-gray-500" />
            System Jobs
          </h1>
          <p className="text-sm text-gray-500">
            Background email/notification queue and scheduled cron run history — retry a stuck job, or
            check whether a scheduled sweep (lead pool SLA, renewal reminders, monthly reports) ran clean.
          </p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {msg && (
        <div className="rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-700">{msg}</div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(['pending', 'processing', 'failed', 'completed'] as const).map((status) => (
          <div key={status} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase text-gray-400">{status}</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">{counts[status] ?? 0}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Queue — pending, processing &amp; failed jobs</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-semibold text-gray-600">Job</th>
                <th className="px-4 py-2 text-left font-semibold text-gray-600">Status</th>
                <th className="px-4 py-2 text-left font-semibold text-gray-600">Attempts</th>
                <th className="px-4 py-2 text-left font-semibold text-gray-600">Next run / error</th>
                <th className="px-4 py-2 text-left font-semibold text-gray-600">Created</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
              ) : jobs.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No pending, processing, or failed jobs.</td></tr>
              ) : jobs.map((job) => (
                <tr key={job.id}>
                  <td className="whitespace-nowrap px-4 py-2 text-gray-900">{job.jobType} <span className="text-gray-400">#{job.id}</span></td>
                  <td className="whitespace-nowrap px-4 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[job.status] || 'bg-gray-100 text-gray-700'}`}>
                      {job.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-gray-500">{job.attempts} / {job.maxAttempts}</td>
                  <td className="max-w-xs truncate px-4 py-2 text-gray-500" title={job.lastError || ''}>
                    {job.status === 'failed' ? (job.lastError || '—') : formatDateTime(job.runAfter)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-gray-500">{formatDateTime(job.createdAt)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    {job.status === 'failed' && (
                      <button
                        onClick={() => handleRetry(job.id)}
                        disabled={retryingId === job.id}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        {retryingId === job.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Recent cron runs</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-semibold text-gray-600">Job</th>
                <th className="px-4 py-2 text-left font-semibold text-gray-600">Status</th>
                <th className="px-4 py-2 text-left font-semibold text-gray-600">Duration</th>
                <th className="px-4 py-2 text-left font-semibold text-gray-600">Detail</th>
                <th className="px-4 py-2 text-left font-semibold text-gray-600">Started</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
              ) : cronRuns.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No cron runs recorded yet.</td></tr>
              ) : cronRuns.map((run) => (
                <tr key={run.id}>
                  <td className="whitespace-nowrap px-4 py-2 text-gray-900">{run.jobName}</td>
                  <td className="whitespace-nowrap px-4 py-2">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${run.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {run.status === 'success' ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                      {run.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-gray-500">
                    <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{run.durationMs != null ? `${run.durationMs}ms` : '—'}</span>
                  </td>
                  <td className="max-w-xs truncate px-4 py-2 text-gray-500" title={run.detail || ''}>{run.detail || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-gray-500">{formatDateTime(run.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
