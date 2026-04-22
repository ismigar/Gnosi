import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { User, Save, ShieldCheck, Mail, Phone, MapPin, CreditCard, FileText } from 'lucide-react';
import { toast } from 'react-hot-toast';
import axios from 'axios';

export default function IdentityProfile() {
    const { t } = useTranslation();
    const [profile, setProfile] = useState({
        full_name: '',
        first_name: '',
        last_name: '',
        email: '',
        phone: '',
        address: '',
        city: '',
        zip_code: '',
        dni_nie: '',
        notes: ''
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchProfile();
    }, []);

    const fetchProfile = async () => {
        try {
            const res = await axios.get('/api/identity');
            setProfile(res.data);
        } catch (error) {
            toast.error('Error carregant el perfil d\'identitat');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await axios.post('/api/identity', profile);
            toast.success('Perfil d\'identitat actualitzat');
        } catch (error) {
            toast.error('Error guardant el perfil');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="w-8 h-8 border-4 border-[var(--gnosi-blue)] border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="max-w-2xl mx-auto p-6 space-y-8 animate-in fade-in duration-500">
            <div className="flex items-center gap-4 mb-2">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center shadow-lg">
                    <User size={24} />
                </div>
                <div>
                    <h2 className="text-2xl font-bold text-[var(--text-primary)]">Perfil d'Identitat</h2>
                    <p className="text-sm text-[var(--text-secondary)]">Aquestes dades s'utilitzen per omplir formularis automàticament.</p>
                </div>
            </div>

            <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-3xl p-8 space-y-6 shadow-sm">
                <div className="flex items-center gap-2 text-[var(--gnosi-blue)] mb-4">
                    <ShieldCheck size={18} />
                    <span className="text-xs font-bold uppercase tracking-widest">Búnker Segur - Dades Locals</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-[var(--text-secondary)] uppercase ml-1">Nom Complet</label>
                        <div className="relative">
                            <input
                                type="text"
                                value={profile.full_name}
                                onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
                                className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-blue)]/20 transition-all"
                                placeholder="P. ex. Joan Puig i Cadafalch"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-bold text-[var(--text-secondary)] uppercase ml-1">Email</label>
                        <div className="relative">
                            <Mail className="absolute left-4 top-3.5 text-[var(--text-secondary)] opacity-40" size={16} />
                            <input
                                type="email"
                                value={profile.email}
                                onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                                className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl pl-11 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-blue)]/20 transition-all"
                                placeholder="el-teu@correu.com"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-bold text-[var(--text-secondary)] uppercase ml-1">Nom</label>
                        <input
                            type="text"
                            value={profile.first_name}
                            onChange={(e) => setProfile({ ...profile, first_name: e.target.value })}
                            className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-blue)]/20 transition-all"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-bold text-[var(--text-secondary)] uppercase ml-1">Cognoms</label>
                        <input
                            type="text"
                            value={profile.last_name}
                            onChange={(e) => setProfile({ ...profile, last_name: e.target.value })}
                            className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-blue)]/20 transition-all"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-bold text-[var(--text-secondary)] uppercase ml-1">Telèfon</label>
                        <div className="relative">
                            <Phone className="absolute left-4 top-3.5 text-[var(--text-secondary)] opacity-40" size={16} />
                            <input
                                type="text"
                                value={profile.phone}
                                onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                                className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl pl-11 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-blue)]/20 transition-all"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-bold text-[var(--text-secondary)] uppercase ml-1">DNI / NIE</label>
                        <div className="relative">
                            <CreditCard className="absolute left-4 top-3.5 text-[var(--text-secondary)] opacity-40" size={16} />
                            <input
                                type="text"
                                value={profile.dni_nie}
                                onChange={(e) => setProfile({ ...profile, dni_nie: e.target.value })}
                                className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl pl-11 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-blue)]/20 transition-all"
                            />
                        </div>
                    </div>
                </div>

                <div className="space-y-2 pt-2">
                    <label className="text-xs font-bold text-[var(--text-secondary)] uppercase ml-1">Adreça</label>
                    <div className="relative">
                        <MapPin className="absolute left-4 top-3.5 text-[var(--text-secondary)] opacity-40" size={16} />
                        <input
                            type="text"
                            value={profile.address}
                            onChange={(e) => setProfile({ ...profile, address: e.target.value })}
                            className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl pl-11 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-blue)]/20 transition-all"
                            placeholder="Carrer, número, pis..."
                        />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-[var(--text-secondary)] uppercase ml-1">Ciutat</label>
                        <input
                            type="text"
                            value={profile.city}
                            onChange={(e) => setProfile({ ...profile, city: e.target.value })}
                            className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-blue)]/20 transition-all"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-[var(--text-secondary)] uppercase ml-1">Codi Postal</label>
                        <input
                            type="text"
                            value={profile.zip_code}
                            onChange={(e) => setProfile({ ...profile, zip_code: e.target.value })}
                            className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-blue)]/20 transition-all"
                        />
                    </div>
                </div>

                <div className="space-y-2">
                    <label className="text-xs font-bold text-[var(--text-secondary)] uppercase ml-1">Notes Addicionals</label>
                    <div className="relative">
                        <FileText className="absolute left-4 top-3.5 text-[var(--text-secondary)] opacity-40" size={16} />
                        <textarea
                            value={profile.notes}
                            onChange={(e) => setProfile({ ...profile, notes: e.target.value })}
                            className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl pl-11 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-blue)]/20 transition-all min-h-[100px]"
                            placeholder="Altra informació útil..."
                        />
                    </div>
                </div>

                <div className="pt-6 flex justify-end">
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-2 px-8 py-3 bg-[var(--gnosi-blue)] hover:bg-[var(--gnosi-blue-hover)] text-white rounded-2xl font-bold transition-all shadow-lg shadow-[var(--gnosi-blue)]/20 active:scale-95 disabled:opacity-50"
                    >
                        {saving ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save size={18} />}
                        Guardar Perfil
                    </button>
                </div>
            </div>
        </div>
    );
}
