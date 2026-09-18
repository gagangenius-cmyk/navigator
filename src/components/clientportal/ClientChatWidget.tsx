'use client';

import { useState, useRef, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, isTextUIPart } from 'ai';
import { MessageCircle, X, Send, Sparkles, Loader2 } from 'lucide-react';

// Floating AI assistant available across the client portal (mounted once in
// ProductPortalShell.tsx) - separate from the "Conversation" page, which is
// a real human case officer channel. This is clearly labeled as AI so a
// client never mistakes one for the other.
export default function ClientChatWidget({ opportunityId, product }: { opportunityId?: string; product?: string }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/clientportal/chat',
      body: { opportunityId, product },
    }),
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, status]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || status === 'submitted' || status === 'streaming') return;
    sendMessage({ text: input.trim() });
    setInput('');
  };

  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-6 z-50 flex h-[32rem] w-96 max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-900 px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-400" />
              <div>
                <p className="text-sm font-semibold">AI Assistant</p>
                <p className="text-[11px] text-slate-300">Answers from your case only - not your case officer</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-slate-300 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && (
              <p className="text-sm text-slate-400">
                Ask me about your case status, document checklist, or what&apos;s pending. For anything I can&apos;t
                answer, use Conversation or Contact CPO to reach your case officer.
              </p>
            )}
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                    message.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-800'
                  }`}
                >
                  {message.parts.filter(isTextUIPart).map((part, i) => (
                    <span key={i}>{part.text}</span>
                  ))}
                </div>
              </div>
            ))}
            {(status === 'submitted' || status === 'streaming') && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1 rounded-2xl bg-slate-100 px-3 py-2 text-sm text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking...
                </div>
              </div>
            )}
            {error && (
              <p className="text-xs text-red-600">
                {error.message.includes('ANTHROPIC_API_KEY')
                  ? 'The AI assistant is not set up yet - please use Conversation or Contact CPO instead.'
                  : "Something went wrong. Please try again, or use Conversation or Contact CPO."}
              </p>
            )}
          </div>

          <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-slate-200 p-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question..."
              className="flex-1 rounded-full border border-slate-300 px-3.5 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            <button
              type="submit"
              disabled={!input.trim() || status === 'submitted' || status === 'streaming'}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-white shadow-xl hover:bg-slate-800"
        title="AI Assistant"
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>
    </>
  );
}
