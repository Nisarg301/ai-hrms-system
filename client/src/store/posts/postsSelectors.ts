import type { RootState } from '../index';
import type { CommentsState } from './postsSlice';

const NO_COMMENTS: CommentsState = { items: [], status: 'idle', error: null };

export const selectPosts = (state: RootState) => state.posts.items;
export const selectPostsStatus = (state: RootState) => state.posts.status;
export const selectPostsError = (state: RootState) => state.posts.error;
export const selectNextCursor = (state: RootState) => state.posts.nextCursor;
export const selectLoadingMorePosts = (state: RootState) => state.posts.loadingMore;
export const selectComments = (postId: string) => (state: RootState) => state.posts.comments[postId] ?? NO_COMMENTS;
