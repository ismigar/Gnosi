import type { NewsletterAccountUpdate } from '../../../shared/api/reader';
import { createReaderSource } from '../../../shared/api/reader';
import { fetchNewsletterAccount } from '../../../shared/api/reader';
import { fetchReaderSources } from '../../../shared/api/reader';
import { importReaderOpml } from '../../../shared/api/reader';
import { syncNewsletterAccount as requestNewsletterSync } from '../../../shared/api/reader';
import { testNewsletterAccount as requestNewsletterTest } from '../../../shared/api/reader';
import { updateNewsletterAccount } from '../../../shared/api/reader';
import { useEffect, useEffectEvent } from 'react';
import type { SettingsState } from './stateTypes';

type Input = SettingsState;

export function useSettingsReader(state: Input) {
  const { isOpen, lastSavedNewsletterAccountRef, newsletterAccount, newsletterAccountLoaded, newsletterAccountSaveTimerRef, newsletterAddress, newsletterName, newsletterOpmlRef, newsletterPasswordDirty, newsletterType, setNewsletterAccount, setNewsletterAccountLoaded, setNewsletterAccountStatus, setNewsletterAccountSyncing, setNewsletterAccountTesting, setNewsletterAddress, setNewsletterName, setNewsletterOpmlLoading, setNewsletterPasswordDirty, setNewsletterSources, setNewsletterSourcesError, setNewsletterSourcesLoaded, setNewsletterSourcesLoading, setNewsletterStatus, setSavingStatus, t } = state;
  const loadNewsletterSources = async () => {
    setNewsletterSourcesLoading(true);
    setNewsletterSourcesError('');
    try {
      const sources = await fetchReaderSources();
      setNewsletterSources(sources.filter(s => s.type !== null && ['rss', 'newsletter', 'youtube', 'newsletter_account'].includes(s.type)));
      setNewsletterSourcesLoaded(true);
    } catch (err) {
      console.error("Error loading newsletters:", err);
      setNewsletterSourcesError(t('subs_sources_load_error_conn'));
    } finally {
      setNewsletterSourcesLoading(false);
    }
  };

  const loadNewsletterAccount = async () => {
    try {
      const data = await fetchNewsletterAccount();
      const next = {
        mail_server: data.mail_server || '',
        mail_port: data.mail_port || 110,
        mail_ssl: data.mail_ssl || 'starttls',
        email: data.email || '',
        password: data.password_set ? '••••••••' : '',
        delete_after_ingest: data.delete_after_ingest
      };
      setNewsletterAccount(next);
      // Baseline to prevent autosave on false changes (e.g. reload after save).
      lastSavedNewsletterAccountRef.current = JSON.stringify({ ...next, _passwordDirty: false });
      setNewsletterAccountLoaded(true);
      setNewsletterPasswordDirty(false);
    } catch (err) {
      console.error('Error loading newsletter account:', err);
    }
  };

  const saveNewsletterAccount = async () => {
    if (!newsletterAccountLoaded) return;
    setSavingStatus('saving');
    try {
      const payload: NewsletterAccountUpdate = {
        mail_server: newsletterAccount.mail_server,
        mail_port: parseInt(String(newsletterAccount.mail_port), 10) || 110,
        mail_ssl: newsletterAccount.mail_ssl,
        email: newsletterAccount.email,
        delete_after_ingest: newsletterAccount.delete_after_ingest
      };
      if (newsletterPasswordDirty) {
        payload.password = newsletterAccount.password;
      }
      await updateNewsletterAccount(payload);
      setSavingStatus('saved');
      setTimeout(() => { setSavingStatus('idle'); }, 2000);
      setNewsletterPasswordDirty(false);
      await loadNewsletterAccount();
    } catch (err) {
      console.error('Error saving newsletter account:', err);
      setSavingStatus('error');
    }
  };

  const testNewsletterAccount = async () => {
    setNewsletterAccountTesting(true);
    setNewsletterAccountStatus(t('subs_news_status_testing'));
    try {
      // We send the current form values: this way the user can test before saving.
      // If the user hasn't touched the password (it's still '••••••••'), we don't send it
      // so the backend uses the one saved in the DB.
      const payload: NewsletterAccountUpdate = {
        mail_server: newsletterAccount.mail_server,
        mail_port: parseInt(String(newsletterAccount.mail_port), 10) || 110,
        mail_ssl: newsletterAccount.mail_ssl,
        email: newsletterAccount.email
      };
      if (newsletterPasswordDirty && newsletterAccount.password) {
        payload.password = newsletterAccount.password;
      }
      const data = await requestNewsletterTest(payload);
      setNewsletterAccountStatus(data.message || '');
    } catch (error) {
      setNewsletterAccountStatus(error instanceof Error
        ? error.message
        : t('subs_news_status_test_error'));
    } finally {
      setNewsletterAccountTesting(false);
    }
  };

  const syncNewsletterAccount = async () => {
    setNewsletterAccountSyncing(true);
    setNewsletterAccountStatus(t('subs_news_status_syncing'));
    try {
      const data = await requestNewsletterSync();
      setNewsletterAccountStatus(data.message || t('subs_news_status_sync_started'));
      await loadNewsletterSources();
    } catch (error) {
      setNewsletterAccountStatus(error instanceof Error
        ? error.message
        : t('subs_news_status_sync_conn_error'));
    } finally {
      setNewsletterAccountSyncing(false);
    }
  };

  const saveAccount = useEffectEvent(() => saveNewsletterAccount());
  useEffect(() => {
    if (!isOpen || !newsletterAccountLoaded) return;
    const current = JSON.stringify({ ...newsletterAccount, _passwordDirty: newsletterPasswordDirty });
    if (lastSavedNewsletterAccountRef.current === current) return;

    if (newsletterAccountSaveTimerRef.current) clearTimeout(newsletterAccountSaveTimerRef.current);
    newsletterAccountSaveTimerRef.current = setTimeout(() => {
      Promise.resolve(saveAccount())
        .then(() => {
          lastSavedNewsletterAccountRef.current = current;
        })
        .catch(() => {
          // Keep the previous baseline so autosave can retry unchanged data.
        });
    }, 800);

    return () => {
      if (newsletterAccountSaveTimerRef.current) clearTimeout(newsletterAccountSaveTimerRef.current);
    };
  }, [newsletterAccount, newsletterPasswordDirty, newsletterAccountLoaded, isOpen, lastSavedNewsletterAccountRef, newsletterAccountSaveTimerRef]);

  const normalizeYoutubeUrl = (rawUrl: string) => {
    if (!rawUrl) return { url: rawUrl, warning: '' };
    const url = rawUrl.trim();
    if (url.includes('/feeds/videos.xml')) return { url, warning: '' };
    let m;
    m = url.match(/youtube\.com\/channel\/(UC[\w-]+)/i);
    if (m) return { url: `https://www.youtube.com/feeds/videos.xml?channel_id=${String(m[1])}`, warning: '' };
    m = url.match(/youtube\.com\/user\/([\w.-]+)/i);
    if (m) return { url: `https://www.youtube.com/feeds/videos.xml?user=${String(m[1])}`, warning: '' };
    m = url.match(/youtube\.com\/playlist\?list=([\w-]+)/i);
    if (m) return { url: `https://www.youtube.com/feeds/videos.xml?playlist_id=${String(m[1])}`, warning: '' };
    m = url.match(/youtube\.com\/@([\w.-]+)/i);
    if (m) return {
      url,
      warning: t('subs_form_status_youtube_handle_warning', { handle: m[1] })
    };
    return { url, warning: '' };
  };

  const handleAddNewsletter = async () => {
    if (!newsletterAddress.trim()) return;
    setNewsletterStatus(t('subs_form_status_adding'));

    let finalUrl = newsletterAddress.trim();
    if (newsletterType === 'youtube') {
      const { url: converted, warning } = normalizeYoutubeUrl(finalUrl);
      if (warning) {
        // normalizeYoutubeUrl already returns the warning via the same i18n key;
        // this branch just re-derives the handle to interpolate it explicitly.
        const handleMatch = finalUrl.match(/youtube\.com\/@([\w.-]+)/i);
        if (handleMatch) {
          setNewsletterStatus(t('subs_form_status_youtube_handle_warning', { handle: handleMatch[1] }));
        } else {
          setNewsletterStatus(warning);
        }
        return;
      }
      finalUrl = converted;
    }

    try {
      await createReaderSource({
        name: newsletterName || finalUrl,
        url: finalUrl,
        type: newsletterType,
      });
      setNewsletterName(''); setNewsletterAddress(''); void loadNewsletterSources();
      setNewsletterStatus(newsletterType === 'youtube' && finalUrl !== newsletterAddress.trim()
        ? t('subs_form_status_youtube_converted', { url: finalUrl })
        : t('subs_form_status_added'));
    } catch (error) {
      setNewsletterStatus(error instanceof Error ? error.message : t('subs_form_status_error'));
    }
  };

  const handleNewsletterOpmlUpload = async (file: File | undefined) => {
    if (!file) return;

    setNewsletterOpmlLoading(true);
    setNewsletterStatus(t('subs_opml_status_importing'));

    try {
      const data = await importReaderOpml(file);
      setNewsletterStatus(data.message || t('subs_opml_status_done'));
      await loadNewsletterSources();
    } catch (err) {
      console.error('Error importing OPML newsletters:', err);
      setNewsletterStatus(t('subs_opml_status_error'));
    } finally {
      setNewsletterOpmlLoading(false);
      if (newsletterOpmlRef.current) {
        newsletterOpmlRef.current.value = '';
      }
    }
  };
  return { handleAddNewsletter, handleNewsletterOpmlUpload, loadNewsletterAccount, loadNewsletterSources, normalizeYoutubeUrl, saveNewsletterAccount, syncNewsletterAccount, testNewsletterAccount };
}
