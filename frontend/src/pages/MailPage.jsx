import React, { useState, useEffect } from 'react';
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
    const [isComposing, setIsComposing] = React.useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [messages, setMessages] = useState([]);
    const [counts, setCounts] = useState({});

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
                const defaultEmail = data.default_mail;
                if (defaultEmail) {
                    const defaultAcc = unique.find(a => (a.email || a.username) === defaultEmail);
                    if (defaultAcc) setSelectedAccount(defaultAcc);
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

    // ESC: closes composer or viewer
    useEffect(() => {
        const handler = (e) => {
            if (e.key !== 'Escape') return;
            if (isComposing) setIsComposing(false);
            else if (selectedMail) setSelectedMail(null);
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [isComposing, selectedMail]);


    const handleMailRead = (id) => {
        setMessages(prev => prev.map(m => m.id === id ? { ...m, is_read: true } : m));
        fetchCounts(accounts);
    };

    const handleSelectFolder = (folder) => {
        setActiveFolder(folder);
        setActiveCategory(null);
        setActiveView(null);
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
        setIsComposing(true);
    };

    const handleMailSelected = (mail) => {
        setIsComposing(false);
        setSelectedMail(mail);
    };

    return (
        <div className="h-full flex flex-col bg-[var(--bg-primary)] overflow-hidden">
            <div className="flex-1 flex overflow-hidden">
                <MailSidebar
                    selectedAccount={selectedAccount}
                    onSelectAccount={setSelectedAccount}
                    accounts={accounts}
                    activeFolder={activeFolder}
                    activeCategory={activeCategory}
                    activeViewId={activeView?.id}
                    onSelectFolder={handleSelectFolder}
                    onSelectCategory={handleSelectCategory}
                    onSelectView={handleSelectView}
                    onCompose={handleCompose}
                    onSearch={setSearchQuery}
                    counts={counts}
                />

                <div className="flex-1 flex overflow-hidden relative">
                    <div className={`transition-all duration-300 ease-in-out h-full border-r border-[var(--border-primary)] ${(selectedMail || isComposing) ? 'w-[380px] bg-[var(--bg-secondary)]/30' : 'w-full'}`}>
                        <MailList
                            account={selectedAccount}
                            accounts={accounts}
                            folder={activeFolder}
                            category={activeCategory}
                            activeView={activeView}
                            onSelectMail={handleMailSelected}
                            selectedMailId={selectedMail?.id}
                            searchQuery={searchQuery}
                            onMessagesLoaded={setMessages}
                            onMailRead={handleMailRead}
                            onBatchDone={() => fetchCounts(accounts)}
                        />
                    </div>

                    <div className={`transition-all duration-300 ease-in-out h-full bg-[var(--bg-primary)] shadow-[-4px_0_15px_-3px_rgba(0,0,0,0.05)] z-10 ${(selectedMail || isComposing) ? 'flex-1 translate-x-0 opacity-100' : 'fixed right-[-100%] translate-x-full opacity-0 pointer-events-none'}`}>
                        {isComposing ? (
                            <MailComposer
                                account={selectedAccount}
                                onClose={() => setIsComposing(false)}
                                onSent={() => setIsComposing(false)}
                            />
                        ) : (
                            <MailViewer
                                account={selectedAccount}
                                mail={selectedMail}
                                onClose={() => setSelectedMail(null)}
                                onMailRead={handleMailRead}
                                onActionDone={() => fetchCounts(accounts)}
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
