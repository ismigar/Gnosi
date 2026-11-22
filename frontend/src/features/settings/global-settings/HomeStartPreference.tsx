import { useTranslation } from 'react-i18next';
import { useHomePreferences } from '../../../shared/api/useHomePreferences';
import { RefreshButton } from '../../../shared/ui/actions/RefreshButton';
import { FormGroup } from '../../../shared/ui/settings/SettingsPrimitives';

export function HomeStartPreference() {
    const { t } = useTranslation();
    const { query, scope, mutation, save } = useHomePreferences();
    if (!scope.vaultId) return null;
    const current = query.data;
    return <FormGroup label={t('home_canvas.start_label')} description={t('home_canvas.start_help')}>
        <select className="gnosi-input" aria-label={t('home_canvas.start_label')} value={current?.start_mode ?? 'page'}
            disabled={!current || mutation.isPending} onChange={event => {
                if (current) void save({ ...current, start_mode: event.target.value === 'canvas' ? 'canvas' : 'page' }).catch(() => {});
            }}>
            <option value="page">{t('home_canvas.follow_page')}</option>
            <option value="canvas">{t('home_canvas.personal_canvas')}</option>
        </select>
        {query.isError && <div role="alert">{t('home_canvas.load_error')} <RefreshButton onClick={() => { void query.refetch(); }} /></div>}
        {mutation.isError && <p role="alert">{t('home_canvas.save_error')}</p>}
    </FormGroup>;
}
