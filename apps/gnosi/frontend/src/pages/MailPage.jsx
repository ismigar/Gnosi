import React, { useState } from 'react';
import MailSidebar from '../components/Mail/MailSidebar';
import MailList from '../components/Mail/MailList';
import MailViewer from '../components/Mail/MailViewer';

export default function MailPage() {
    const [selectedMail, setSelectedMail] = React.useState(null);
    const [selectedAccount, setSelectedAccount] = React.useState(null);
    const [activeFolder, setActiveFolder] = React.useState('INBOX');
    const [activeCategory, setActiveCategory] = React.useState(null);

    const handleSelectFolder = (folder) => {
        setActiveFolder(folder);
        setActiveCategory(null);
        setSelectedMail(null);
    };

    const handleSelectCategory = (category) => {
        setActiveCategory(category);
        setActiveFolder(null); // O podríem filtrar per carpeta i categoria alhora, però normalment les categories són vistes globals
        setSelectedMail(null);
    };

    return (
        <div className="h-full flex flex-col bg-slate-50 overflow-hidden">
            <div className="flex-1 flex overflow-hidden">
                {/* 1. Sidebar (Carpetes i Etiquetes) */}
                <MailSidebar
                    selectedAccount={selectedAccount}
                    onSelectAccount={setSelectedAccount}
                    activeFolder={activeFolder}
                    activeCategory={activeCategory}
                    onSelectFolder={handleSelectFolder}
                    onSelectCategory={handleSelectCategory}
                />

                {/* 2. List (Llista de correus) */}
                <MailList
                    account={selectedAccount}
                    folder={activeFolder}
                    category={activeCategory}
                    onSelectMail={(mail) => setSelectedMail(mail)}
                />

                {/* 3. Viewer (Visualitzador de correu) */}
                <MailViewer
                    account={selectedAccount}
                    mail={selectedMail}
                />
            </div>
        </div>
    );
}
