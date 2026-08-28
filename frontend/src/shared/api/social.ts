import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { unwrapApiResult } from './errors';


export type SocialStream = components['schemas']['Stream'];
export type SocialNetwork = components['schemas']['SocialNetwork'];
export type SocialPost = components['schemas']['SocialPost'];
export type SocialInteraction = components['schemas']['InteractionRequest'];
export type SocialInteractionResult = components['schemas']['InteractionResponse'];
type GeneratedSocialComposeInput = components['schemas']['ComposeRequest'];
export type SocialComposeInput = Pick<GeneratedSocialComposeInput, 'networks'> &
  Partial<Omit<GeneratedSocialComposeInput, 'networks'>>;
export type SocialComposeResult = components['schemas']['ComposeResponse'];
type GeneratedSocialPublishInput = components['schemas']['PublishRequest'];
export type SocialPublishInput = Omit<
  GeneratedSocialPublishInput,
  'save_record' | 'source_title'
> &
  Partial<Pick<GeneratedSocialPublishInput, 'save_record' | 'source_title'>>;
export type SocialPublicationResult = components['schemas']['PublicationResponse'];
export type SocialPostInput = components['schemas']['CreatePostRequest'];
type GeneratedSocialScheduleInput = components['schemas']['SchedulePublishRequest'];
export type SocialScheduleInput = Omit<
  GeneratedSocialScheduleInput,
  'source_title'
> &
  Partial<Pick<GeneratedSocialScheduleInput, 'source_title'>>;
export type SocialScheduleResult =
  components['schemas']['ScheduledPublicationResponse'];
export type ScheduledSocialPost = components['schemas']['ScheduledPostResponse'];
export type CancelScheduledSocialPostResult =
  components['schemas']['CancelScheduledPostResponse'];
export type ProcessScheduledSocialResult =
  components['schemas']['ProcessScheduledResponse'];
export type SocialPostHistoryItem = components['schemas']['PostHistoryResponse'];


export async function fetchSocialStreams(): Promise<SocialStream[]> {
  return unwrapApiResult<SocialStream[], unknown>(
    await apiClient.GET('/api/social/streams'),
  );
}


export async function updateSocialStreams(
  streams: SocialStream[],
): Promise<void> {
  unwrapApiResult(
    await apiClient.PUT('/api/social/streams', { body: streams }),
  );
}


export async function fetchSocialNetworks(): Promise<SocialNetwork[]> {
  return unwrapApiResult<SocialNetwork[], unknown>(
    await apiClient.GET('/api/social/networks'),
  );
}


export async function updateSocialNetworks(
  networks: SocialNetwork[],
): Promise<void> {
  unwrapApiResult(
    await apiClient.PUT('/api/social/networks', { body: networks }),
  );
}


export async function fetchSocialFeed(
  streamId: string,
  limit = 20,
): Promise<SocialPost[]> {
  return unwrapApiResult<SocialPost[], unknown>(
    await apiClient.GET('/api/social/feed/{stream_id}', {
      params: {
        path: { stream_id: streamId },
        query: { limit },
      },
    }),
  );
}


export async function interactSocialPost(
  interaction: SocialInteraction,
): Promise<SocialInteractionResult> {
  return unwrapApiResult<SocialInteractionResult, unknown>(
    await apiClient.POST('/api/social/interact', { body: interaction }),
  );
}


export async function composeSocialPosts(
  input: SocialComposeInput,
): Promise<SocialComposeResult> {
  return unwrapApiResult<SocialComposeResult, unknown>(
    await apiClient.POST('/api/social/compose', {
      body: {
        content: '',
        hint: '',
        title: '',
        url: '',
        variation: 0,
        ...input,
      },
    }),
  );
}


export async function publishSocialPosts(
  input: SocialPublishInput,
): Promise<SocialPublicationResult> {
  return unwrapApiResult<SocialPublicationResult, unknown>(
    await apiClient.POST('/api/social/publish', {
      body: { save_record: true, source_title: '', ...input },
    }),
  );
}


export async function createSocialPost(
  input: SocialPostInput,
): Promise<SocialPublicationResult> {
  return unwrapApiResult<SocialPublicationResult, unknown>(
    await apiClient.POST('/api/social/post', { body: input }),
  );
}


export async function scheduleSocialPosts(
  input: SocialScheduleInput,
): Promise<SocialScheduleResult> {
  return unwrapApiResult<SocialScheduleResult, unknown>(
    await apiClient.POST('/api/social/schedule', {
      body: { source_title: '', ...input },
    }),
  );
}


export async function fetchScheduledSocialPosts(): Promise<ScheduledSocialPost[]> {
  return unwrapApiResult<ScheduledSocialPost[], unknown>(
    await apiClient.GET('/api/social/scheduled'),
  );
}


export async function cancelScheduledSocialPost(
  postId: string,
): Promise<CancelScheduledSocialPostResult> {
  return unwrapApiResult<CancelScheduledSocialPostResult, unknown>(
    await apiClient.DELETE('/api/social/scheduled/{post_id}', {
      params: { path: { post_id: postId } },
    }),
  );
}


export async function processScheduledSocialPosts(): Promise<ProcessScheduledSocialResult> {
  return unwrapApiResult<ProcessScheduledSocialResult, unknown>(
    await apiClient.POST('/api/social/process-scheduled'),
  );
}


export async function fetchSocialPostHistory(): Promise<SocialPostHistoryItem[]> {
  return unwrapApiResult<SocialPostHistoryItem[], unknown>(
    await apiClient.GET('/api/social/history'),
  );
}
