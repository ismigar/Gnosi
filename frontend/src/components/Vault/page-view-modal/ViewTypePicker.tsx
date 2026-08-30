import { VIEW_TYPES } from '../viewConstants';
import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';

export function ViewTypePicker({
    t, viewType, setViewType
}: Pick<
    ModalInput & useViewStateResult,
    't'
    | 'viewType'
    | 'setViewType'
>) {
    return (<>                            <div>
        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-2">{t('view.type_label', "View type")}</label>
        <div className="grid grid-cols-4 gap-2">
            {VIEW_TYPES.map(vt => {
                const Icon = vt.icon;
                const active = viewType === vt.id;
                return (
                    <button
                        key={vt.id}
                        type="button"
                        onClick={() => { setViewType(vt.id); }}
                        className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-all ${active
                                ? 'border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]'
                                : 'border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                            }`}
                        title={t(`view.type_${vt.id}`, vt.label)}
                    >
                        <Icon size={18} />
                        <span className="text-[10px] font-semibold">{t(`view.type_${vt.id}`, vt.label)}</span>
                    </button>
                );
            })}
        </div>
    </div></>);
}
