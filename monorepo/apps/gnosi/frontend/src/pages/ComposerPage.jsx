import React from 'react';
import Composer from '../components/social/Composer';
import { PenTool, Share2 } from 'lucide-react';

const ComposerPage = () => {
    return (
        <div className="p-8 bg-[#0a0a0c] min-h-screen text-white relative overflow-hidden">
            <div className="home-page__glow home-page__glow--1" style={{ opacity: 0.1 }} />
            <div className="home-page__glow home-page__glow--2" style={{ opacity: 0.1 }} />

            <header className="mb-12 relative z-10">
                <div className="flex items-center gap-3 mb-2">
                    <PenTool className="text-blue-400" size={32} />
                    <h1 className="text-4xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-500">
                        Composer
                    </h1>
                </div>
                <p className="text-gray-400">Crea i programa contingut per a les teves xarxes socials.</p>
            </header>

            <div className="relative z-10 max-w-3xl mx-auto">
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <Composer />
                </div>
                
                <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <a href="/social-dashboard" className="glass-panel p-6 rounded-2xl border border-white/5 hover:border-blue-500/30 transition-all group">
                        <div className="flex items-center gap-3 mb-2">
                            <Share2 className="text-gray-400 group-hover:text-blue-400 transition-colors" size={20} />
                            <h3 className="font-bold">Social Dashboard</h3>
                        </div>
                        <p className="text-sm text-gray-500">Gestiona els teus streams i feeds de xarxes socials.</p>
                    </a>
                    {/* Add more shortcuts if needed */}
                </div>
            </div>
        </div>
    );
};

export default ComposerPage;
