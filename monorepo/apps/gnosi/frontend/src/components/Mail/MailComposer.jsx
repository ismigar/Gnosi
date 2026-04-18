import React, { useState } from 'react';
import { Send, X, Paperclip, Sparkles, RefreshCw } from 'lucide-react';
import { toast } from 'react-hot-toast';
import MailBlockEditor from './MailBlockEditor';

export default function MailComposer({ account, onClose, onSent }) {
    const [to, setTo] = useState('');
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [sending, setSending] = useState(false);
    const [aiGenerating, setAiGenerating] = useState(false);
    const editorRef = React.useRef(null);

    const handleSend = async () => {
        if (!to.trim() || !body.trim() || !account?.email) {
            toast.error("Omple el destinatari i el cos del missatge");
            return;
        }

        setSending(true);
        try {
            const res = await fetch(`/api/mail/send?email=${encodeURIComponent(account.email)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to, subject, body })
            });
            const data = await res.json();
            if (data.status === 'success') {
                toast.success("Correu enviat correctament!");
                if (onSent) onSent();
                onClose();
            } else {
                toast.error("Error enviant el correu");
            }
        } catch (err) {
            console.error("Error sending mail:", err);
            toast.error("Error de connexió");
        } finally {
            setSending(false);
        }
    };

    const handleAIAssist = async () => {
        if (!subject && !body) {
            toast.error("Escriu un assumpte o esborrany primer");
            return;
        }
        setAiGenerating(true);
        try {
            const res = await fetch('/api/mail/ai/generate_draft', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ context: body, prompt: `Create a professional draft about: ${subject}` })
            });
            const data = await res.json();
            setBody(data.draft);
            toast.success("Esborrany generat amb IA");
        } catch (err) {
            toast.error("Error generant l'esborrany");
        } finally {
            setAiGenerating(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-white relative animate-in slide-in-from-right-4 duration-300">
            {/* Header */}
            <div className="h-16 border-b border-slate-100 px-6 flex items-center justify-between sticky top-0 z-20 bg-white/80 backdrop-blur-md">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
                        <Send size={16} />
                    </div>
                    <h2 className="font-bold text-slate-900">Nou missatge</h2>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 transition-all">
                    <X size={20} />
                </button>
            </div>

            {/* Inputs Section */}
            <div className="flex-1 overflow-y-auto p-8 space-y-6">
                <div className="space-y-4 max-w-[800px] mx-auto">
                    <div className="flex items-center border-b border-slate-100 py-2">
                        <span className="text-[13px] font-bold text-slate-400 uppercase w-16">Para:</span>
                        <input 
                            type="text" 
                            className="flex-1 bg-transparent border-none text-[15px] focus:ring-0 placeholder:text-slate-300 font-medium" 
                            placeholder="exemple@correu.com"
                            value={to}
                            onChange={(e) => setTo(e.target.value)}
                        />
                    </div>
                    <div className="flex items-center border-b border-slate-100 py-2">
                        <span className="text-[13px] font-bold text-slate-400 uppercase w-16">Assumpte:</span>
                        <input 
                            type="text" 
                            className="flex-1 bg-transparent border-none text-[15px] focus:ring-0 placeholder:text-slate-300 font-bold text-slate-900" 
                            placeholder="Sense assumpte"
                            value={subject}
                            onChange={(e) => setSubject(e.target.value)}
                        />
                    </div>

                    {/* Editor */}
                    <div className="pt-6 min-h-[400px]">
                        <MailBlockEditor 
                            initialContent={body}
                            onChange={setBody}
                            editorRef={editorRef}
                        />
                    </div>
                </div>
            </div>

            {/* Footer Toolbar */}
            <div className="p-6 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-2">
                    <button onClick={handleAIAssist} disabled={aiGenerating} className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-xl text-sm font-bold transition-all shadow-sm">
                        {aiGenerating ? <RefreshCw size={16} className="animate-spin" /> : <Sparkles size={16} />}
                        IA Draft
                    </button>
                    <button className="p-2.5 hover:bg-white rounded-xl text-slate-400 transition-all border border-transparent hover:border-slate-100">
                        <Paperclip size={18} />
                    </button>
                </div>
                <button 
                    onClick={handleSend}
                    disabled={sending}
                    className="flex items-center gap-2 px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold shadow-lg shadow-indigo-100 transition-all active:scale-95 disabled:opacity-50"
                >
                    {sending ? <RefreshCw size={18} className="animate-spin" /> : <Send size={18} />}
                    Enviar
                </button>
            </div>
        </div>
    );
}
