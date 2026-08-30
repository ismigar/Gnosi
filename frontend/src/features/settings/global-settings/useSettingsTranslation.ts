import { deleteCredential } from '../../../shared/api/credentials';
import { fetchCredentialStatus } from '../../../shared/api/credentials';
import { fetchEnvironment } from '../../../shared/api/environment';
import { saveCredential } from '../../../shared/api/credentials';
import { toast } from '../../../shared/notifications/toast';
import { updateEnvironment } from '../../../shared/api/environment';
import { useCallback } from 'react';
import { useEffect } from 'react';
import type { SettingsState } from './stateTypes';

type Input = SettingsState;

export function useSettingsTranslation(state: Input) {
  const { activeTab, deeplAutoSaveRef, isOpen, setTranslateState, softcatalaAutoSaveRef, softcatalaBaselineRef, t, translateState } = state;
  useEffect(() => {
    if (activeTab !== 'translate' || !isOpen) return;
    let cancelled = false;
    setTranslateState(s => ({ ...s, loading: true }));
    void Promise.all([
      fetchCredentialStatus('deepl_api_key').catch(() => ({ has_value: false })),
      fetchEnvironment().catch((): Record<string, string> => ({})),
    ]).then(([cred, env]) => {
      if (cancelled) return;
      // Baseline BEFORE state so the autosave effect triggered by this
      // setState sees the loaded value as already persisted.
      softcatalaBaselineRef.current = env.SOFTCATALA_API_URL || '';
      setTranslateState(s => ({
        ...s,
        deepl_has_value: cred.has_value,
        softcatala_url: env.SOFTCATALA_API_URL || '',
        deepl_input: '',
        loading: false,
      }));
    });
    return () => { cancelled = true; };
  }, [activeTab, isOpen, setTranslateState, softcatalaBaselineRef]);

  const saveDeeplKey = useCallback(async (value: string) => {
    setTranslateState(s => ({ ...s, saving_deepl: true, saved_deepl: false }));
    try {
      await saveCredential({ key: 'deepl_api_key', value });
      setTranslateState(s => (
        s.deepl_input.trim() === value
          ? { ...s, deepl_has_value: true, deepl_input: '', saving_deepl: false, saved_deepl: true }
          : { ...s, deepl_has_value: true, saving_deepl: false } // user kept typing: the next debounce will re-save
      ));
    } catch (error) {
      console.error('Error saving DeepL API key:', error);
      toast.error(t('translate_settings.deepl_save_error', "No s'ha pogut desar la clau de DeepL."));
      setTranslateState(s => ({ ...s, saving_deepl: false }));
    }
  }, [setTranslateState, t]);

  useEffect(() => {
    if (activeTab !== 'translate' || !isOpen) return;
    const value = translateState.deepl_input.trim();
    if (!value) return; // empty input never saves (deletion has its own button)
    clearTimeout(deeplAutoSaveRef.current);
    deeplAutoSaveRef.current = setTimeout(() => { void saveDeeplKey(value); }, 1200);
    return () => { clearTimeout(deeplAutoSaveRef.current); };
  }, [translateState.deepl_input, activeTab, isOpen, saveDeeplKey, deeplAutoSaveRef]);

  const handleDeleteDeeplKey = async () => {
    setTranslateState(s => ({ ...s, saving_deepl: true }));
    try {
      await deleteCredential('deepl_api_key');
      setTranslateState(s => ({ ...s, deepl_has_value: false, deepl_input: '', saving_deepl: false }));
    } catch (error) {
      console.error('Error deleting DeepL API key:', error);
      toast.error(t('translate_settings.deepl_delete_error', "No s'ha pogut eliminar la clau de DeepL."));
      setTranslateState(s => ({ ...s, saving_deepl: false }));
    }
  };

  const saveSoftcatalaUrl = useCallback(async (value: string) => {
    setTranslateState(s => ({ ...s, saving_softcatala: true, saved_softcatala: false }));
    try {
      // Empty string → reset to default. We send an empty string to
      // overwrite, and if the user wanted to remove it, the backend
      // persists as `SOFTCATALA_API_URL=` (the skill falls back to the default).
      await updateEnvironment({ SOFTCATALA_API_URL: value });
      softcatalaBaselineRef.current = value;
      setTranslateState(s => ({ ...s, saving_softcatala: false, saved_softcatala: true }));
    } catch (error) {
      console.error('Error saving Softcatalà URL:', error);
      toast.error(t('translate_settings.softcatala_save_error', "No s'ha pogut desar la URL de Softcatalà."));
      setTranslateState(s => ({ ...s, saving_softcatala: false }));
    }
  }, [setTranslateState, softcatalaBaselineRef, t]);

  useEffect(() => {
    if (activeTab !== 'translate' || !isOpen) return;
    if (softcatalaBaselineRef.current === null) return; // initial load not done yet
    const value = translateState.softcatala_url.trim();
    if (value === softcatalaBaselineRef.current) return; // nothing new to persist
    clearTimeout(softcatalaAutoSaveRef.current);
    softcatalaAutoSaveRef.current = setTimeout(() => { void saveSoftcatalaUrl(value); }, 800);
    return () => { clearTimeout(softcatalaAutoSaveRef.current); };
  }, [translateState.softcatala_url, activeTab, isOpen, saveSoftcatalaUrl, softcatalaAutoSaveRef, softcatalaBaselineRef]);
  return { handleDeleteDeeplKey, saveDeeplKey, saveSoftcatalaUrl };
}
