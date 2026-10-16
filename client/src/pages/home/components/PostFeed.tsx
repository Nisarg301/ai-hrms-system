import { Alert, Button, Card, Skeleton } from 'antd';
import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../../hooks/store';
import {
  selectLoadingMorePosts,
  selectNextCursor,
  selectPosts,
  selectPostsError,
  selectPostsStatus,
} from '../../../store/posts/postsSelectors';
import { fetchFeed, fetchMorePosts } from '../../../store/posts/postsThunks';
import { EmptyNote } from './HomeCard';
import { PostCard } from './PostCard';

interface PostFeedProps {
  myId: string;
  myName: string;
  myAvatarUrl: string | null | undefined;
}

export function PostFeed({ myId, myName, myAvatarUrl }: PostFeedProps) {
  const dispatch = useAppDispatch();
  const posts = useAppSelector(selectPosts);
  const status = useAppSelector(selectPostsStatus);
  const error = useAppSelector(selectPostsError);
  const nextCursor = useAppSelector(selectNextCursor);
  const loadingMore = useAppSelector(selectLoadingMorePosts);

  useEffect(() => {
    void dispatch(fetchFeed());
  }, [dispatch]);

  if (status === 'failed') {
    return <Alert type="error" showIcon message={error} action={<Button size="small" onClick={() => dispatch(fetchFeed())}>Retry</Button>} />;
  }
  if (status !== 'succeeded' && posts.length === 0) {
    return (
      <Card>
        <Skeleton active avatar />
      </Card>
    );
  }
  if (posts.length === 0) {
    return (
      <Card>
        <EmptyNote>No posts yet. Be the first to say hello 👋</EmptyNote>
      </Card>
    );
  }
  return (
    <div>
      {posts.map((post) => (
        <PostCard key={post.id} post={post} myId={myId} myName={myName} myAvatarUrl={myAvatarUrl} />
      ))}
      {nextCursor ? (
        <div className="text-center">
          <Button loading={loadingMore} onClick={() => dispatch(fetchMorePosts(nextCursor))}>
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
