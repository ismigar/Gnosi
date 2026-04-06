import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Calendar, History, BarChart2, Settings } from 'lucide-react';

export function SocialNav() {
    const navItems = [
        { to: '/social-dashboard', icon: LayoutDashboard, label: 'Dashboard' },
        { to: '/social/calendar', icon: Calendar, label: 'Calendar' },
        { to: '/social/history', icon: History, label: 'History' },
        // { to: '/social/analytics', icon: BarChart2, label: 'Analytics' },
    ];

    return (
        <nav className="h-full w-16 flex flex-col items-center py-6 glass-panel border-r border-white/5 bg-surface/30 backdrop-blur-xl z-50">
            <div className="mb-8 p-2 bg-primary/20 rounded-xl">
                <div className="w-6 h-6 bg-gradient-to-tr from-primary to-accent rounded-lg" />
            </div>

            <div className="flex-1 flex flex-col gap-4 w-full px-2">
                {navItems.map(({ to, icon: Icon, label }) => (
                    <NavLink
                        key={to}
                        to={to}
                        title={label}
                        className={({ isActive }) => `
              w-12 h-12 flex items-center justify-center rounded-xl transition-all duration-300
              ${isActive
                                ? 'bg-primary text-white shadow-lg shadow-primary/30'
                                : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/5'}
            `}
                    >
                        <Icon size={22} strokeWidth={1.5} />
                    </NavLink>
                ))}
            </div>

            <div className="mt-auto pb-4">
                <button className="w-12 h-12 flex items-center justify-center rounded-xl text-zinc-500 hover:text-zinc-200 hover:bg-white/5 transition-all">
                    <Settings size={22} strokeWidth={1.5} />
                </button>
            </div>
        </nav>
    );
}
