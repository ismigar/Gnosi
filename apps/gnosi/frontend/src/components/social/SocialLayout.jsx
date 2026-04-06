import React from 'react';
import { SocialNav } from './SocialNav';

export function SocialLayout({ children, title, action }) {
    return (
        <div className="flex h-screen w-screen bg-background overflow-hidden text-zinc-200 font-sans selection:bg-primary/30">
            {/* Background Ambience */}
            <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[40%] bg-accent/10 rounded-full blur-[100px] pointer-events-none" />

            {/* Navigation */}
            <SocialNav />

            {/* Main Content */}
            <div className="flex-1 flex flex-col relative z-0 h-full overflow-hidden">
                {/* Header */}
                {(title || action) && (
                    <header className="h-16 px-6 flex items-center justify-between border-b border-white/5 bg-transparent backdrop-blur-sm shrink-0">
                        <h1 className="text-xl font-semibold tracking-tight text-white flex items-center gap-2">
                            {title}
                        </h1>
                        <div className="flex gap-3">
                            {action}
                        </div>
                    </header>
                )}

                {/* Content Scrollable Area */}
                <main className="flex-1 overflow-x-hidden overflow-y-auto p-6 scrollbar-thin">
                    {children}
                </main>
            </div>
        </div>
    );
}
