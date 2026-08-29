import type {
    SocialComposeResult,
    SocialNetwork,
    SocialPublicationResult,
    SocialPublishInput,
    SocialScheduleResult,
} from '../../../shared/api/social';


export type SocialProposal = SocialComposeResult['proposals'][string];
export type SocialProposals = Readonly<Record<string, SocialProposal>>;
export type SocialDrafts = Readonly<Record<string, string>>;
export type SocialResult = SocialPublicationResult | SocialScheduleResult;
export type SocialStep = 'compose' | 'select';


export interface PublishSocialState {
    readonly composing: boolean;
    readonly drafts: SocialDrafts;
    readonly hint: string;
    readonly networks: readonly SocialNetwork[];
    readonly proposals: SocialProposals;
    readonly publishing: boolean;
    readonly regeneratingNetwork: string | null;
    readonly scheduleOpen: boolean;
    readonly scheduledAt: string;
    readonly selected: ReadonlySet<string>;
    readonly sourceContent: string;
    readonly sourceTitle: string;
    readonly step: SocialStep;
    readonly variationByNetwork: Readonly<Record<string, number>>;
}


export type PublishSocialAction =
    | { readonly type: 'compose-finished'; readonly proposals: SocialProposals }
    | { readonly type: 'compose-started' }
    | { readonly type: 'compose-stopped' }
    | { readonly type: 'draft-changed'; readonly network: string; readonly value: string }
    | { readonly type: 'hint-changed'; readonly value: string }
    | { readonly type: 'networks-loaded'; readonly networks: readonly SocialNetwork[] }
    | { readonly type: 'publish-finished' }
    | { readonly type: 'publish-started' }
    | { readonly type: 'regenerate-finished'; readonly network: string; readonly proposal?: SocialProposal; readonly variation: number }
    | { readonly type: 'regenerate-started'; readonly network: string }
    | { readonly type: 'schedule-open-changed'; readonly value: boolean }
    | { readonly type: 'scheduled-at-changed'; readonly value: string }
    | { readonly type: 'source-content-changed'; readonly value: string }
    | { readonly type: 'source-loaded'; readonly content: string; readonly title: string }
    | { readonly type: 'source-title-changed'; readonly value: string }
    | { readonly type: 'step-changed'; readonly value: SocialStep }
    | { readonly type: 'toggle-network'; readonly network: string };


export function initialPublishSocialState(
    metadata: Readonly<Record<string, unknown>>,
): PublishSocialState {
    return {
        composing: false,
        drafts: {},
        hint: '',
        networks: [],
        proposals: {},
        publishing: false,
        regeneratingNetwork: null,
        scheduleOpen: false,
        scheduledAt: '',
        selected: new Set(),
        sourceContent: '',
        sourceTitle: typeof metadata.title === 'string' ? metadata.title.trim() : '',
        step: 'select',
        variationByNetwork: {},
    };
}


export function publishSocialReducer(
    state: PublishSocialState,
    action: PublishSocialAction,
): PublishSocialState {
    if (action.type === 'networks-loaded') return {
        ...state,
        networks: action.networks,
        selected: new Set(action.networks.filter(({ configured }) => configured).map(({ id }) => id)),
    };
    if (action.type === 'toggle-network') {
        const selected = new Set(state.selected);
        if (selected.has(action.network)) selected.delete(action.network);
        else selected.add(action.network);
        return { ...state, selected };
    }
    if (action.type === 'source-loaded') return {
        ...state,
        sourceContent: action.content,
        sourceTitle: action.title,
    };
    if (action.type === 'source-title-changed') return { ...state, sourceTitle: action.value };
    if (action.type === 'source-content-changed') return { ...state, sourceContent: action.value };
    if (action.type === 'hint-changed') return { ...state, hint: action.value };
    if (action.type === 'compose-started') return { ...state, composing: true };
    if (action.type === 'compose-stopped') return { ...state, composing: false };
    if (action.type === 'compose-finished') return {
        ...state,
        composing: false,
        drafts: Object.fromEntries(Object.entries(action.proposals).map(
            ([network, proposal]) => [network, proposal.text],
        )),
        proposals: action.proposals,
        step: 'compose',
    };
    if (action.type === 'regenerate-started') {
        return { ...state, regeneratingNetwork: action.network };
    }
    if (action.type === 'regenerate-finished') return {
        ...state,
        drafts: action.proposal ? {
            ...state.drafts,
            [action.network]: action.proposal.text,
        } : state.drafts,
        proposals: action.proposal ? {
            ...state.proposals,
            [action.network]: action.proposal,
        } : state.proposals,
        regeneratingNetwork: null,
        variationByNetwork: action.proposal ? {
            ...state.variationByNetwork,
            [action.network]: action.variation,
        } : state.variationByNetwork,
    };
    if (action.type === 'draft-changed') return {
        ...state,
        drafts: { ...state.drafts, [action.network]: action.value },
    };
    if (action.type === 'schedule-open-changed') return { ...state, scheduleOpen: action.value };
    if (action.type === 'scheduled-at-changed') return { ...state, scheduledAt: action.value };
    if (action.type === 'publish-started') return { ...state, publishing: true };
    if (action.type === 'publish-finished') return { ...state, publishing: false };
    return { ...state, step: action.value };
}


export function deriveSocialContent(metadata: Readonly<Record<string, unknown>>): string {
    const parts: string[] = [];
    if (typeof metadata.title === 'string' && metadata.title) parts.push(metadata.title);
    let longest = '';
    Object.entries(metadata).forEach(([key, value]) => {
        if (key !== 'title' && typeof value === 'string' && value.length > longest.length) {
            longest = value;
        }
    });
    if (longest) parts.push(longest);
    return parts.join('\n\n').trim();
}


export function buildSocialPosts(
    selected: readonly string[],
    drafts: SocialDrafts,
): Record<string, SocialPublishInput['posts'][string]> {
    return Object.fromEntries(selected.flatMap((network) => {
        const text = (drafts[network] ?? '').trim();
        return text ? [[network, { text }]] : [];
    }));
}


export function socialErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) return error.message;
    if (!isUnknownRecord(error)) return fallback;
    const response = error.response;
    if (!isUnknownRecord(response)) return fallback;
    const data = response.data;
    if (!isUnknownRecord(data)) return fallback;
    const detail = data.detail;
    return typeof detail === 'string' && detail ? detail : fallback;
}


function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
