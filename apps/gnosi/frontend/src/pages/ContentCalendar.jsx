import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, Trash2, AlertCircle } from 'lucide-react';
import { SocialLayout } from '../components/social/SocialLayout';

const ContentCalendar = () => {
    const [scheduledPosts, setScheduledPosts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [currentWeek, setCurrentWeek] = useState(new Date());

    useEffect(() => {
        fetchScheduledPosts();
    }, []);

    const fetchScheduledPosts = async () => {
        try {
            const res = await fetch('/api/social/scheduled');
            if (res.ok) {
                const data = await res.json();
                setScheduledPosts(data);
            }
        } catch (error) {
            console.error('Error fetching scheduled posts:', error);
        } finally {
            setLoading(false);
        }
    };

    const cancelPost = async (postId) => {
        if (!confirm('Cancel this scheduled post?')) return;

        try {
            const res = await fetch(`/api/social/scheduled/${postId}`, { method: 'DELETE' });
            if (res.ok) {
                setScheduledPosts(prev => prev.filter(p => p.id !== postId));
            }
        } catch (error) {
            alert('Error cancelling post');
        }
    };

    // Get days of the current week
    const getWeekDays = () => {
        const startOfWeek = new Date(currentWeek);
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay() + 1); // Monday

        const days = [];
        for (let i = 0; i < 7; i++) {
            const day = new Date(startOfWeek);
            day.setDate(day.getDate() + i);
            days.push(day);
        }
        return days;
    };

    // Get posts for a specific day
    const getPostsForDay = (day) => {
        const dayStr = day.toISOString().split('T')[0];
        return scheduledPosts.filter(post => {
            const postDay = post.scheduled_time.split('T')[0];
            return postDay === dayStr;
        });
    };

    const formatTime = (isoString) => {
        return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const isToday = (day) => {
        return day.toDateString() === new Date().toDateString();
    };

    const weekDays = getWeekDays();

    const navigateWeek = (direction) => {
        const newDate = new Date(currentWeek);
        newDate.setDate(newDate.getDate() + (direction * 7));
        setCurrentWeek(newDate);
    };

    const ActionControls = (
        <div className="flex items-center gap-4 bg-white/5 rounded-lg p-1 border border-white/5">
            <button
                onClick={() => navigateWeek(-1)}
                className="p-1.5 hover:bg-white/10 rounded-md transition-colors text-zinc-400 hover:text-white"
            >
                <ChevronLeft size={20} />
            </button>
            <span className="font-semibold text-sm w-32 text-center text-zinc-200">
                {weekDays[0].toLocaleDateString('ca-ES', { month: 'short', day: 'numeric' })} -
                {weekDays[6].toLocaleDateString('ca-ES', { month: 'short', day: 'numeric' })}
            </span>
            <button
                onClick={() => navigateWeek(1)}
                className="p-1.5 hover:bg-white/10 rounded-md transition-colors text-zinc-400 hover:text-white"
            >
                <ChevronRight size={20} />
            </button>
        </div>
    );

    return (
        <SocialLayout title="Calendar" action={ActionControls}>
            <div className="h-full flex flex-col">
                {loading ? (
                    <div className="flex flex-col justify-center items-center h-full text-zinc-500 gap-4">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                        <span>Carregant calendari...</span>
                    </div>
                ) : (
                    <div className="grid grid-cols-7 gap-4 h-full min-h-[600px]">
                        {weekDays.map((day, idx) => {
                            const dayPosts = getPostsForDay(day);
                            const dayName = day.toLocaleDateString('ca-ES', { weekday: 'short' });
                            const dayNum = day.getDate();
                            const today = isToday(day);

                            return (
                                <div
                                    key={idx}
                                    className={`
                                        flex flex-col rounded-xl overflow-hidden transition-all duration-300
                                        ${today
                                            ? 'glass-panel border-primary/50 bg-primary/10 shadow-lg shadow-primary/10'
                                            : 'glass-card hover:bg-white/5 border-white/5'
                                        }
                                    `}
                                >
                                    {/* Day Header */}
                                    <div className={`
                                        p-3 text-center border-b flex flex-col items-center gap-1
                                        ${today ? 'border-primary/20 bg-primary/20' : 'border-white/5 bg-white/5'}
                                    `}>
                                        <div className={`text-xs font-semibold uppercase tracking-wider ${today ? 'text-blue-200' : 'text-zinc-500'}`}>
                                            {dayName}
                                        </div>
                                        <div className={`text-2xl font-bold ${today ? 'text-white' : 'text-zinc-300'}`}>
                                            {dayNum}
                                        </div>
                                    </div>

                                    {/* Posts */}
                                    <div className="flex-1 p-2 space-y-2 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700">
                                        {dayPosts.length === 0 ? (
                                            <div className="text-xs text-zinc-600 text-center py-8 flex flex-col items-center gap-2 opacity-50">
                                                <span>—</span>
                                            </div>
                                        ) : (
                                            dayPosts.map(post => (
                                                <div
                                                    key={post.id}
                                                    className="group relative p-3 bg-black/20 hover:bg-black/40 border border-white/5 hover:border-white/10 rounded-lg transition-all"
                                                >
                                                    <div className="flex items-center gap-1.5 text-xs font-medium text-blue-400 mb-1.5">
                                                        <Clock size={12} />
                                                        {formatTime(post.scheduled_time)}
                                                    </div>

                                                    <div className="text-sm text-zinc-300 line-clamp-3 mb-2 leading-relaxed">
                                                        {post.content}
                                                    </div>

                                                    <div className="flex gap-1 flex-wrap">
                                                        {post.networks.map(net => (
                                                            <span
                                                                key={net}
                                                                className="px-1.5 py-0.5 bg-white/10 text-zinc-400 rounded text-[10px] uppercase font-bold tracking-wider"
                                                            >
                                                                {net}
                                                            </span>
                                                        ))}
                                                    </div>

                                                    <button
                                                        onClick={() => cancelPost(post.id)}
                                                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded transition-all"
                                                        title="Cancel"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </SocialLayout>
    );
};

export default ContentCalendar;
