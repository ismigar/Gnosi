import { expect, it } from 'vitest';
import { sortPluginsByName } from './pluginSettingsModel';

it('orders displayed names alphabetically without changing registry order', () => {
  const plugins = [
    { id: 'first', name: 'Zulu' }, { id: 'second', name: 'Àlbum' },
    { id: 'third', name: 'beta' }, { id: 'fourth', name: 'Calendari 10' },
    { id: 'fifth', name: 'Calendari 2' },
  ];
  expect(sortPluginsByName(plugins, plugin => plugin.name, 'ca').map(plugin => plugin.id))
    .toEqual(['second', 'third', 'fifth', 'fourth', 'first']);
  expect(plugins.map(plugin => plugin.id)).toEqual(['first', 'second', 'third', 'fourth', 'fifth']);
});

it('follows translated labels when the interface language changes', () => {
  const plugins = [{ ca: 'Referències', en: 'References' }, { ca: 'Traducció', en: 'Translation' }, { ca: 'Xarxes socials', en: 'Social publishing' }];
  expect(sortPluginsByName(plugins, plugin => plugin.ca, 'ca').map(plugin => plugin.ca))
    .toEqual(['Referències', 'Traducció', 'Xarxes socials']);
  expect(sortPluginsByName(plugins, plugin => plugin.en, 'en').map(plugin => plugin.en))
    .toEqual(['References', 'Social publishing', 'Translation']);
});
