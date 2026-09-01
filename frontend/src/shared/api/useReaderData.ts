import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createReaderSource,
  deleteReaderSource,
  fetchNewsletterAccount,
  fetchReaderArticles,
  fetchReaderInventory,
  fetchReaderPodcastInfo,
  fetchReaderSources,
  importReaderOpml,
  markReaderArticleRead,
  updateNewsletterAccount,
  type ReaderArticlesQuery,
  type ReaderArticle,
  type ReaderInventory,
  type ReaderInventoryQuery,
  type ReaderSource,
} from './reader';


export const readerQueryKeys = {
  all: ['reader'] as const,
  articles: (query: ReaderArticlesQuery) => ['reader', 'articles', query] as const,
  inventory: (query: ReaderInventoryQuery) => ['reader', 'inventory', query] as const,
  newsletterAccount: ['reader', 'newsletter-account'] as const,
  podcastInfo: ['reader', 'podcast', 'info'] as const,
  sources: ['reader', 'sources'] as const,
};


function queryUsesUnreadOnly(queryKey: readonly unknown[]): boolean {
  const query = queryKey[2];
  return typeof query === 'object'
    && query !== null
    && 'unreadOnly' in query
    && query.unreadOnly === true;
}


export function useReaderSources() {
  return useQuery({
    queryFn: fetchReaderSources,
    queryKey: readerQueryKeys.sources,
  });
}


export function useCreateReaderSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createReaderSource,
    onSuccess: async (source) => {
      queryClient.setQueryData<ReaderSource[]>(readerQueryKeys.sources, (sources) =>
        sources ? [...sources, source] : [source],
      );
      await queryClient.invalidateQueries({ queryKey: readerQueryKeys.all });
    },
  });
}


export function useDeleteReaderSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteReaderSource,
    onSuccess: async (_result, sourceId) => {
      queryClient.setQueryData<ReaderSource[]>(readerQueryKeys.sources, (sources) =>
        sources?.filter((source) => source.id !== sourceId),
      );
      await queryClient.invalidateQueries({ queryKey: readerQueryKeys.all });
    },
  });
}


export function useImportReaderOpml() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: importReaderOpml,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: readerQueryKeys.all });
    },
  });
}


export function useNewsletterAccount() {
  return useQuery({
    queryFn: fetchNewsletterAccount,
    queryKey: readerQueryKeys.newsletterAccount,
  });
}


export function useUpdateNewsletterAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateNewsletterAccount,
    onSuccess: (account) => {
      queryClient.setQueryData(readerQueryKeys.newsletterAccount, account);
    },
  });
}


export function useReaderArticles(query: ReaderArticlesQuery) {
  return useQuery({
    queryFn: () => fetchReaderArticles(query),
    queryKey: readerQueryKeys.articles(query),
  });
}


export function useReaderInventory(query: ReaderInventoryQuery) {
  return useQuery({
    queryFn: () => fetchReaderInventory(query),
    queryKey: readerQueryKeys.inventory(query),
  });
}


export function useMarkReaderArticleRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ articleId, read }: {
      articleId: number;
      read?: boolean;
      sourceId?: number | null;
    }) =>
      markReaderArticleRead(articleId, read),
    onMutate: async ({ articleId, read = true, sourceId }) => {
      await queryClient.cancelQueries({ queryKey: readerQueryKeys.all });
      const previousArticles = queryClient.getQueriesData<ReaderArticle[]>({
        queryKey: ['reader', 'articles'],
      });
      const previousInventories = queryClient.getQueriesData<ReaderInventory>({
        queryKey: ['reader', 'inventory'],
      });
      for (const [queryKey, articles] of previousArticles) {
        queryClient.setQueryData<ReaderArticle[]>(
          queryKey,
          read && queryUsesUnreadOnly(queryKey)
            ? articles?.filter((article) => article.id !== articleId)
            : articles?.map((article) =>
              article.id === articleId ? { ...article, is_read: read } : article,
            ),
        );
      }
      if (read) {
        for (const [queryKey, inventory] of previousInventories) {
          if (!inventory) continue;
          const unreadOnly = queryUsesUnreadOnly(queryKey);
          queryClient.setQueryData<ReaderInventory>(queryKey, {
            ...inventory,
            count: unreadOnly ? Math.max(0, inventory.count - 1) : inventory.count,
            feeds: unreadOnly
              ? inventory.feeds.map((feed) =>
                feed.id === sourceId
                  ? { ...feed, count: Math.max(0, feed.count - 1) }
                  : feed,
              )
              : inventory.feeds,
            read_count: unreadOnly ? inventory.read_count : inventory.read_count + 1,
            unread_count: Math.max(0, inventory.unread_count - 1),
          });
        }
      }
      return { previousArticles, previousInventories };
    },
    onError: (_error, _variables, context) => {
      for (const [key, data] of context?.previousArticles ?? []) {
        queryClient.setQueryData(key, data);
      }
      for (const [key, data] of context?.previousInventories ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: readerQueryKeys.all });
    },
  });
}


export function useReaderPodcastInfo(enabled = true) {
  return useQuery({
    enabled,
    queryFn: fetchReaderPodcastInfo,
    queryKey: readerQueryKeys.podcastInfo,
  });
}
