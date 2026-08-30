import type { SocialNetwork, SocialStream } from '../../../shared/api/social';
import { fetchSocialNetworks } from '../../../shared/api/social';
import { fetchSocialStreams } from '../../../shared/api/social';
import { toast } from '../../../shared/notifications/toast';
import { updateSocialNetworks } from '../../../shared/api/social';
import { updateSocialStreams } from '../../../shared/api/social';
import type { SettingsState } from './stateTypes';

type Input = SettingsState;

export function useSettingsSocial(state: Input) {
  const { newStreamForm, setNewStreamForm, setShowAddStream, setSocialNetworks, setSocialStreams, socialNetworks, socialStreams, tn } = state;
  const loadSocialSettings = async () => {
    try {
      const [networks, streams] = await Promise.all([
        fetchSocialNetworks(),
        fetchSocialStreams(),
      ]);
      setSocialNetworks(networks);
      setSocialStreams(streams);
    } catch { /* silent */ }
  };

  const saveSocialNetworks = async (updated: SocialNetwork[]) => {
    // Update optimistic; rollback si la xarxa falla.
    const previous = socialNetworks;
    setSocialNetworks(updated);
    try {
      await updateSocialNetworks(updated);
    } catch (err) {
      // Without this restoration, the UI showed the changes as if
      // would have been saved even though the backend had the old state.
      setSocialNetworks(previous);
      toast.error(tn('social.save_networks_error'));
      console.error('[social] saveSocialNetworks failed', err);
    }
  };

  const saveSocialStreams = async (updated: SocialStream[]) => {
    const previous = socialStreams;
    setSocialStreams(updated);
    try {
      await updateSocialStreams(updated);
    } catch (err) {
      setSocialStreams(previous);
      toast.error(tn('social.save_streams_error'));
      console.error('[social] saveSocialStreams failed', err);
    }
  };

  const handleAddSocialStream = () => {
    if (!newStreamForm.id.trim() || !newStreamForm.title.trim()) return;
    const updated = [...socialStreams, { ...newStreamForm }];
    void saveSocialStreams(updated);
    setNewStreamForm({ id: '', title: '', icon: '📡', network: 'mastodon' });
    setShowAddStream(false);
  };
  return { handleAddSocialStream, loadSocialSettings, saveSocialNetworks, saveSocialStreams };
}
