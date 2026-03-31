import React, { useState } from 'react';
import { Calendar, Clock, X, Check } from 'lucide-react';

const Scheduler = ({ onSchedule, onCancel }) => {
    const [date, setDate] = useState('');
    const [time, setTime] = useState('');

    // Get minimum date (today)
    const today = new Date().toISOString().split('T')[0];

    const handleSchedule = () => {
        if (date && time) {
            const scheduledDateTime = new Date(`${date}T${time}`);
            onSchedule(scheduledDateTime);
        }
    };

    // Quick schedule options
    const quickOptions = [
        { label: '+1 hour', hours: 1 },
        { label: '+3 hours', hours: 3 },
        { label: 'Tomorrow 9:00', tomorrow: true, hour: 9 },
        { label: 'Tomorrow 18:00', tomorrow: true, hour: 18 },
    ];

    const applyQuickOption = (option) => {
        const now = new Date();
        let scheduled;

        if (option.tomorrow) {
            scheduled = new Date(now);
            scheduled.setDate(scheduled.getDate() + 1);
            scheduled.setHours(option.hour, 0, 0, 0);
        } else {
            scheduled = new Date(now.getTime() + option.hours * 60 * 60 * 1000);
        }

        setDate(scheduled.toISOString().split('T')[0]);
        setTime(scheduled.toTimeString().slice(0, 5));
    };

    return (
        <div className="bg-black/80 backdrop-blur-xl p-5 rounded-xl border border-white/10 mt-3 shadow-2xl">
            <h4 className="text-sm font-semibold mb-3 text-zinc-200 flex items-center gap-2">
                <Calendar size={16} className="text-primary" />
                <span>Programar Post</span>
            </h4>

            {/* Quick Options */}
            <div className="flex flex-wrap gap-2 mb-4">
                {quickOptions.map((opt, idx) => (
                    <button
                        key={idx}
                        onClick={() => applyQuickOption(opt)}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/5 text-zinc-400 hover:bg-primary/20 hover:text-primary transition-all border border-white/5 hover:border-primary/20"
                    >
                        {opt.label}
                    </button>
                ))}
            </div>

            {/* Date & Time Inputs */}
            <div className="flex gap-3 mb-4">
                <div className="flex-1">
                    <label className="block text-xs font-medium text-zinc-500 mb-1.5 ml-1">Data</label>
                    <div className="relative">
                        <input
                            type="date"
                            value={date}
                            min={today}
                            onChange={(e) => setDate(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-zinc-200 text-sm focus:ring-2 focus:ring-primary/50 focus:border-primary/50 focus:outline-none transition-all placeholder-zinc-600"
                        />
                    </div>
                </div>
                <div className="flex-1">
                    <label className="block text-xs font-medium text-zinc-500 mb-1.5 ml-1">Hora</label>
                    <div className="relative">
                        <input
                            type="time"
                            value={time}
                            onChange={(e) => setTime(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-zinc-200 text-sm focus:ring-2 focus:ring-primary/50 focus:border-primary/50 focus:outline-none transition-all"
                        />
                    </div>
                </div>
            </div>

            {/* Preview */}
            {date && time && (
                <div className="text-xs text-zinc-400 mb-4 p-3 bg-primary/10 border border-primary/20 rounded-lg flex items-center gap-2">
                    <Clock size={14} className="text-primary" />
                    <span>Es publicarà el: <strong className="text-zinc-200">{new Date(`${date}T${time}`).toLocaleString()}</strong></span>
                </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 text-sm">
                <button
                    onClick={onCancel}
                    className="px-4 py-2 text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors flex items-center gap-1"
                >
                    Cancel·la
                </button>
                <button
                    onClick={handleSchedule}
                    disabled={!date || !time}
                    className="px-4 py-2 bg-primary hover:bg-blue-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg font-medium transition-all shadow-lg shadow-primary/20 flex items-center gap-1.5 transform active:scale-95"
                >
                    <Check size={16} />
                    Confirmar
                </button>
            </div>
        </div>
    );
};

export default Scheduler;
