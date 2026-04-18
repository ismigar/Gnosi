import React, { useState } from 'react';
import MailSidebar from '../components/Mail/MailSidebar';
import MailList from '../components/Mail/MailList';
import MailViewer from '../components/Mail/MailViewer';
import MailComposer from '../components/Mail/MailComposer';

export default function MailPage() {
    const [selectedMail, setSelectedMail] = React.useState(null);
    const [selectedAccount, setSelectedAccount] = React.useState(null);
    const [activeFolder, setActiveFolder] = React.useState('INBOX');
    const [activeCategory, setActiveCategory] = React.useState(null);
    const [isComposing, setIsComposing] = React.useState(false);

    const handleSelectFolder = (folder) => {
        setActiveFolder(folder);
        setActiveCategory(null);
        setSelectedMail(null);
    };

    const handleSelectCategory = (category) => {
        setActiveCategory(category);
        setActiveFolder(null); // O podríem filtrar per carpeta i categoria alhora, però normalment les categories són vistes globals
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
                {/* 1. Sidebar (Carpetes i Etiquetes) */}
                <MailSidebar
                    selectedAccount={selectedAccount}
                    onSelectAccount={setSelectedAccount}
                    activeFolder={activeFolder}
                    activeCategory={activeCategory}
                    onSelectFolder={handleSelectFolder}
                    onSelectCategory={handleSelectCategory}
                    onCompose={handleCompose}
                />

                <div className="flex-1 flex overflow-hidden relative">
                    {/* 2. List (Llista de correus) */}
                    <div className={`transition-all duration-300 ease-in-out h-full border-r border-slate-200 ${(selectedMail || isComposing) ? 'w-[380px] bg-slate-50/30' : 'w-full'}`}>
                        <MailList
                            account={selectedAccount}
                            folder={activeFolder}
                            category={activeCategory}
                            onSelectMail={handleMailSelected}
                            selectedMailId={selectedMail?.id}
                        />
                    </div>

                    {/* 3. Panel Lateral (Visualitzador o Compositor) */}
                    <div className={`transition-all duration-300 ease-in-out h-full bg-white shadow-[-4px_0_15px_-3px_rgba(0,0,0,0.05)] z-10 ${(selectedMail || isComposing) ? 'flex-1 translate-x-0 opacity-100' : 'fixed right-[-100%] translate-x-full opacity-0 pointer-events-none'}`}>
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
                             />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
