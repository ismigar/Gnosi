export const BRAND_COLORS = {
    mastodon: '#6364ff',
    bluesky: '#1185fe',
    linkedin: '#0a66c2',
    facebook: '#0866ff',
    telegram: '#27a7e7',
};

export type SocialNetwork = keyof typeof BRAND_COLORS;

export const isKnownSocialNetwork = (network: unknown): network is SocialNetwork => (
    typeof network === 'string' && Object.hasOwn(BRAND_COLORS, network)
);
