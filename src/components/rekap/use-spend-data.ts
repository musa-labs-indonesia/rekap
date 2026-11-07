import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, fetchData } from "./api";
import { queryKeys } from "./query-keys";

export function useSpendData({
  profileId,
  start,
  end,
  category,
  onUnauthorized,
}: {
  profileId: string;
  start: string;
  end: string;
  category: string;
  onUnauthorized: () => void;
}) {
  const query = useQuery({
    queryKey: queryKeys.spend(profileId, start, end, category),
    queryFn: () => fetchData({ profile: profileId, start, end, category }),
    enabled: Boolean(profileId) && Boolean(start) && Boolean(end),
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.status === 401) && failureCount < 1,
  });

  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401) onUnauthorized();
  }, [query.error, onUnauthorized]);

  return {
    expenses: query.data?.expenses ?? [],
    categories: query.data?.categories ?? [],
    loading: query.isFetching,
    error: query.error instanceof Error ? query.error.message : "",
    reload: query.refetch,
  };
}
