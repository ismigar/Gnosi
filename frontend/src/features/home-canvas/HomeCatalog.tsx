import { Check, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { canAddBlock, type BlockDefinition, type HomeBlockKind } from './model';
import type { StoredHomeBlock } from '../../shared/api/home-canvas';

interface Props {
    readonly available: readonly BlockDefinition[];
    readonly blocks: readonly StoredHomeBlock[];
    readonly onAdd: (kind: HomeBlockKind) => void;
}

export function HomeCatalog({ available, blocks, onAdd }: Props) {
    const { t } = useTranslation();
    const groups = [...new Set(available.map(item => item.appKey))];
    return <section id="home-block-catalog" className="home-catalog" aria-label={t('home_canvas.catalog')}>
        <h2>{t('home_canvas.catalog')}</h2>
        <div className="home-catalog__groups">
            {groups.map(group => <div key={group}><h3>{t(group)}</h3>
                {available.filter(item => item.appKey === group).map(({ kind, titleKey }) => {
                    const selectable = canAddBlock(kind, blocks);
                    const Icon = selectable ? Plus : Check;
                    return <button className="home-catalog__option" type="button" key={kind} disabled={!selectable}
                        data-add-kind={kind} aria-label={t(selectable ? 'home_canvas.add_named' : 'home_canvas.already_added', { title: t(titleKey) })}
                        onClick={() => { onAdd(kind); }}>
                        <Icon size={15} aria-hidden="true" /><span>{t(titleKey)}</span>
                    </button>;
                })}
            </div>)}
        </div>
    </section>;
}
