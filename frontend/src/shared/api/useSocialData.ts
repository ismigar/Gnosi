import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import {
  cancelScheduledSocialPost,
  fetchScheduledSocialPosts,
  fetchSocialFeed,
  fetchSocialNetworks,
  fetchSocialPostHistory,
  fetchSocialStreams,
  updateSocialStreams,
  type ScheduledSocialPost,
  type SocialStream,
} from './social';


export const socialQueryKeys = {
  all: ['social'] as const,
  feed: (streamId: string) => ['social', 'feed', streamId] as const,
  history: ['social', 'history'] as const,
  networks: ['social', 'networks'] as const,
  scheduled: ['social', 'scheduled'] as const,
  streams: ['social', 'streams'] as const,
};


export function useSocialStreams() {
  return useQuery({
    queryFn: fetchSocialStreams,
    queryKey: socialQueryKeys.streams,
  });
}


export function useUpdateSocialStreams() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateSocialStreams,
    onMutate: async (streams) => {
      await queryClient.cancelQueries({ queryKey: socialQueryKeys.streams });
      const previous = queryClient.getQueryData<SocialStream[]>(socialQueryKeys.streams);
      queryClient.setQueryData(socialQueryKeys.streams, streams);
      return { previous };
    },
    onError: (_error, _streams, context) => {
      if (context?.previous) {
        queryClient.setQueryData(socialQueryKeys.streams, context.previous);
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: socialQueryKeys.streams });
    },
  });
}


export function useSocialFeeds(streams: readonly SocialStream[]) {
  return useQueries({
    queries: streams.map((stream) => ({
      queryFn: () => fetchSocialFeed(stream.id),
      queryKey: socialQueryKeys.feed(stream.id),
    })),
  });
}


export function useSocialNetworks() {
  return useQuery({
    queryFn: fetchSocialNetworks,
    queryKey: socialQueryKeys.networks,
  });
}


export function useScheduledSocialPosts() {
  return useQuery({
    queryFn: fetchScheduledSocialPosts,
    queryKey: socialQueryKeys.scheduled,
  });
}


export function useCancelScheduledSocialPost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: cancelScheduledSocialPost,
    onSuccess: async (_result, postId) => {
      queryClient.setQueryData<ScheduledSocialPost[]>(
        socialQueryKeys.scheduled,
        (posts) => posts?.filter((post) => post.id !== postId),
      );
      await queryClient.invalidateQueries({ queryKey: socialQueryKeys.scheduled });
      await queryClient.invalidateQueries({
        queryKey: socialQueryKeys.feed('scheduled'),
      });
    },
  });
}


export function useSocialPostHistory() {
  return useQuery({
    queryFn: fetchSocialPostHistory,
    queryKey: socialQueryKeys.history,
  });
}
