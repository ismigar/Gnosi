import { describe, expect, it } from 'vitest';

import {
    buildSocialPosts,
    deriveSocialContent,
    initialPublishSocialState,
    publishSocialReducer,
    socialErrorMessage,
} from './publishSocialModel';


describe('publishSocialModel', () => {
    it('derives fallback content from title and the longest text field', () => {
        expect(deriveSocialContent({
            excerpt: 'Short',
            notes: 'This is the longest source body.',
            title: 'Research',
        })).toBe('Research\n\nThis is the longest source body.');
    });

    it('preselects only configured social networks', () => {
        const state = publishSocialReducer(initialPublishSocialState({}), {
            networks: [
                { configured: true, enabled: true, icon: 'M', id: 'mastodon', name: 'Mastodon' },
                { configured: false, enabled: true, icon: 'B', id: 'bluesky', name: 'Bluesky' },
            ],
            type: 'networks-loaded',
        });
        expect([...state.selected]).toEqual(['mastodon']);
    });

    it('materializes editable drafts from generated proposals', () => {
        const state = publishSocialReducer(initialPublishSocialState({}), {
            proposals: {
                mastodon: {
                    char_count: 5,
                    hashtags: [],
                    over_limit: false,
                    provider: 'test',
                    text: 'Hello',
                },
            },
            type: 'compose-finished',
        });
        expect(state.step).toBe('compose');
        expect(state.drafts).toEqual({ mastodon: 'Hello' });
    });

    it('trims drafts and omits empty posts', () => {
        expect(buildSocialPosts(
            ['mastodon', 'bluesky'],
            { bluesky: '   ', mastodon: '  Hello  ' },
        )).toEqual({ mastodon: { text: 'Hello' } });
    });

    it('extracts nested API details with a safe fallback', () => {
        expect(socialErrorMessage({
            response: { data: { detail: 'Publisher unavailable' } },
        }, 'Fallback')).toBe('Publisher unavailable');
        expect(socialErrorMessage(null, 'Fallback')).toBe('Fallback');
    });
});
