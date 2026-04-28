import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'react-hot-toast';
import MailSidebar from '../components/Mail/MailSidebar';
import MailList from '../components/Mail/MailList';
import MailViewer from '../components/Mail/MailViewer';
import MailComposer from '../components/Mail/MailComposer';

export default function MailPage() {
    const [selectedMail, setSelectedMail] = React.useState(null);
    const [selectedAccount, setSelectedAccount] = React.useState(null);
    const [accounts, setAccounts] = useState([]);
    const [activeFolder, setActiveFolder] = React.useState('INBOX');
    const [activeCategory, setActiveCategory] = React.useState(null);
    const [activeView, setActiveView] = React.useState(null);
    const [activeTagId, setActiveTagId] = React.useState(null);
    const [isComposing, setIsComposing] = React.useState(false);
    const [composeData, setComposeData] = React.useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [messages, setMessages] = useState([]);
    const [counts, setCounts] = useState({});
    const [showMailboxSidebar, setShowMailboxSidebar] = useState(true);
    const [removedMailId, setRemovedMailId] = useState(null);
    const [readMailId, setReadMailId] = useState(null);
    const [listRefreshToken, setListRefreshToken] = useState(0);

    const undoRef = useRef(null);
    const executeUndoRef = useRef(null);

    const [identities, setIdentities] = React.useState([]);
    const [defaultAccount, setDefaultAccount] = React.useState(null);

    useEffect(() => {
        fetch('/api/integrations')
            .then(res => res.json())
            .then(data => {
                const allMail = [...(data.mail_accounts || []), ...(data.emails || [])];
                const seen = new Set();
                const unique = allMail.filter(acc => {
                    const email = acc.email || acc.username;
                    if (!email) return false;
                    const lower = email.toLowerCase();
                    if (seen.has(lower)) return false;
                    seen.add(lower);
                    return true;
                });
                setAccounts(unique);

                // Expand each account + its aliases as selectable "From" identities
                const expanded = unique.flatMap(acc => {
                    const parentEmail = acc.email || acc.username;
                    const entries = [acc];
                    (acc.aliases || []).forEach(alias => {
                        if (alias.email) entries.push({
                            ...alias,
                            name: alias.display_name || alias.email,
                            smtp_email: parentEmail,
                        });
                    });
                    return entries;
                });
                setIdentities(expanded);

                const defaultEmail = data.default_mail;
                if (defaultEmail) {
                    const defaultAcc = unique.find(a => (a.email || a.username) === defaultEmail);
                    if (defaultAcc) {
                        setSelectedAccount(defaultAcc);
                        setDefaultAccount(defaultAcc);
                    }
                } else if (unique.length > 0) {
                    setDefaultAccount(unique[0]);
                }
            })
            .catch(() => {});
    }, []);

    const fetchCounts = (accs) => {
        const emailList = selectedAccount?.email
            ? [selectedAccount.email]
            : accs.map(a => a.email || a.username).filter(Boolean);
        if (!emailList.length) return;
        Promise.all(emailList.map(e => fetch(`/api/mail/counts?email=${encodeURIComponent(e)}`).then(r => r.json()).catch(() => ({}))))
            .then(results => {
                const merged = {};
                results.forEach(res => {
                    Object.entries(res).forEach(([key, val]) => {
                        if (!merged[key]) merged[key] = { total: 0, unread: 0 };
                        merged[key].total += val.total || 0;
                        merged[key].unread += val.unread || 0;
                    });
                });
                setCounts(merged);
            });
    };

    useEffect(() => { if (accounts.length) fetchCounts(accounts); }, [accounts, selectedAccount]);

    // ── Undo: reverse last archive/trash via move to INBOX ──
    const executeUndo = async () => {
        const action = undoRef.current;
        if (!action) return;
        undoRef.current = null;
        toast.dismiss('undo-toast');
        try {
            const res = await fetch(
                `/api/mail/messages/${action.mailId}/move?email=${encodeURIComponent(action.email)}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ target_folder: 'INBOX', imap_uid: action.imap_uid, imap_folder: action.imap_folder }),
                }
            );
            if (!res.ok) throw new Error('move_failed');
            setRemovedMailId(null);
            setListRefreshToken(t => t + 1);
            fetchCounts(accounts);
            toast.success('Acció desfeta');
        } catch {
            toast.error("No s'ha pogut desfer");
        }
    };
    executeUndoRef.current = executeUndo;

    const recordUndo = (type, mailId, email, extra = {}) => {
        undoRef.current = { type, mailId, email, ...extra };
        setTimeout(() => {
            if (undoRef.current?.mailId === mailId) undoRef.current = null;
        }, 8000);
        const label = type === 'trash' ? 'Eliminat' : 'Arxivat';
        toast(
            <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span>{label}</span>
                <button
                    onClick={() => executeUndoRef.current?.()}
                    style={{ fontWeight: 700, textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit' }}
                >
                    Desfer
                </button>
                <span style={{ opacity: 0.5, fontSize: '11px' }}>⌘Z</span>
            </span>,
            { id: 'undo-toast', duration: 8000 }
        );
    };

    // ── Cmd+Z global handler ──
    useEffect(() => {
        const handler = (e) => {
            if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
                const active = document.activeElement;
                if (['INPUT', 'TEXTAREA'].includes(active?.tagName) || active?.isContentEditable) return;
                e.preventDefault();
                executeUndoRef.current?.();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    // ── ESC: closes viewer (composer handles its own Escape) ──
    useEffect(() => {
        const handler = (e) => {
            if (e.key !== 'Escape') return;
            if (!isComposing && selectedMail) setSelectedMail(null);
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [isComposing, selectedMail]);

    const handleMailRead = (id) => {
        setReadMailId(id);
        fetchCounts(accounts);
    };

    const handleMailMoved = (mailId) => {
        setRemovedMailId(mailId);
        setSelectedMail(null);
        fetchCounts(accounts);
    };

    // Called by MailViewer on archive/delete: navigate to adjacent mail
    const handleActionDone = (mailId, actionType, email, extra) => {
        fetchCounts(accounts);

        if (mailId) {
            // Navigate to next (or previous) mail
            const idx = messages.findIndex(m => m.id === mailId);
            if (idx >= 0) {
                const next = messages[idx + 1] || messages[idx - 1] || null;
                setSelectedMail(next);
            } else {
                setSelectedMail(null);
            }
            // Tell MailList to remove this message from its state
            setRemovedMailId(mailId);
        }

        if (actionType && email && (actionType === 'trash' || actionType === 'archive')) {
            recordUndo(actionType, mailId, email, extra);
        }
    };

    const handleSelectFolder = (folder) => {
        setActiveFolder(folder);
        setActiveCategory(null);
        setActiveView(null);
        setActiveTagId(null);
        setSelectedMail(null);
    };

    const handleSelectTag = (tagId) => {
        setActiveTagId(tagId);
        setSelectedMail(null);
    };

    const handleSelectCategory = (category) => {
        setActiveCategory(category);
        setActiveFolder(null);
        setActiveView(null);
        setSelectedMail(null);
        setIsComposing(false);
    };

    const handleSelectView = (view) => {
        setActiveView(view);
        if (view) {
            setActiveFolder(null);
            setActiveCategory(null);
        } else {
            setActiveFolder('INBOX');
        }
        setSelectedMail(null);
        setIsComposing(false);
    };

    const handleCompose = () => {
        setSelectedMail(null);
        const effectiveAccount = selectedAccount || defaultAccount;
        const prefix = effectiveAccount?.subject_prefix || '';
        setComposeData(prefix ? { initialSubject: prefix } : null);
        setIsComposing(true);
    };

    const handleOpenComposer = (data) => {
        setComposeData(data || null);
        setIsComposing(true);
    };

    const handleMailSelected = (mail) => {
        if (mail?.type === 'Draft' && mail?.source === 'vault') {
            setComposeData({
                initialTo: mail.recipient || '',
                initialCc: mail.cc || '',
                initialSubject: mail.subject === '(Esborrany)' ? '' : (mail.subject || ''),
                initialBody: mail.body_text || '',
                _draftId: mail.id,
            });
            setSelectedMail(null);
            setIsComposing(true);
            return;
        }
        setIsComposing(false);
        setSelectedMail(mail);
    };

    return (
        <div className="h-full flex flex-col bg-[var(--bg-primary)] overflow-hidden">
            <div className="flex-1 flex overflow-hidden">
                {showMailboxSidebar && (
                    <MailSidebar
                        selectedAccount={selectedAccount}
                        onSelectAccount={setSelectedAccount}
                        accounts={accounts}
                        activeFolder={activeFolder}
                        activeCategory={activeCategory}
                        activeViewId={activeView?.id}
                        activeTagId={activeTagId}
                        onSelectFolder={handleSelectFolder}
                        onSelectCategory={handleSelectCategory}
                        onSelectView={handleSelectView}
                        onSelectTag={handleSelectTag}
                        onCompose={handleCompose}
                        onSearch={setSearchQuery}
                        counts={counts}
                    />
                )}

                <div className="flex-1 flex overflow-hidden relative">
                    <div className={`transition-all duration-300 ease-in-out h-full border-r border-[var(--border-primary)] ${(selectedMail || isComposing) ? 'w-[380px] bg-[var(--bg-secondary)]/30' : 'w-full'}`}>
                        <MailList
                            account={selectedAccount}
                            accounts={accounts}
                            folder={activeFolder}
                            category={activeCategory}
                            activeView={activeView}
                            activeTagId={activeTagId}
                            onSelectMail={handleMailSelected}
                            selectedMailId={selectedMail?.id}
                            isComposing={isComposing}
                            searchQuery={searchQuery}
                            onMessagesLoaded={setMessages}
                            onMailRead={handleMailRead}
                            onBatchDone={() => fetchCounts(accounts)}
                            showMailboxSidebar={showMailboxSidebar}
                            onToggleMailboxSidebar={() => setShowMailboxSidebar(v => !v)}
                            removedMailId={removedMailId}
                            readMailId={readMailId}
                            listRefreshToken={listRefreshToken}
                            onRecordAction={(type, mailId, email, extra) => {
                                recordUndo(type, mailId, email, extra);
                                if ((type === 'trash' || type === 'archive') && mailId === selectedMail?.id) {
                                    const idx = messages.findIndex(m => m.id === mailId);
                                    const next = idx >= 0 ? (messages[idx + 1] || messages[idx - 1] || null) : null;
                                    setSelectedMail(next);
                                }
                            }}
                        />
                    </div>

                    <div className={`transition-all duration-300 ease-in-out h-full bg-[var(--bg-primary)] shadow-[-4px_0_15px_-3px_rgba(0,0,0,0.05)] z-10 ${(selectedMail || isComposing) ? 'flex-1 translate-x-0 opacity-100' : 'fixed right-[-100%] translate-x-full opacity-0 pointer-events-none'}`}>
                        {isComposing ? (
                            <MailComposer
                                account={selectedAccount}
                                accounts={identities}
                                onClose={() => { setIsComposing(false); setComposeData(null); }}
                                onSent={() => { setIsComposing(false); setComposeData(null); }}
                                onDraftSaved={() => setListRefreshToken(t => t + 1)}
                                {...(composeData || {})}
                            />
                        ) : (
                            <MailViewer
                                account={selectedAccount}
                                mail={selectedMail}
                                onClose={() => setSelectedMail(null)}
                                onMailRead={handleMailRead}
                                onActionDone={handleActionDone}
                                onMoved={handleMailMoved}
                                onCompose={handleOpenComposer}
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
