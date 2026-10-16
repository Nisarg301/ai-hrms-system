import { createSlice } from '@reduxjs/toolkit';
import type { ListStatus } from '../../types/api';
import type { Post, PostComment } from '../../types/post';
import {
  addComment,
  createPost,
  deleteComment,
  deletePost,
  fetchComments,
  fetchFeed,
  fetchMorePosts,
  toggleLike,
} from './postsThunks';

export interface CommentsState {
  items: PostComment[];
  status: ListStatus;
  error: string | null;
}

export interface PostsState {
  items: Post[];
  nextCursor: string | null;
  status: ListStatus;
  loadingMore: boolean;
  error: string | null;
  /** Loaded when a post's comments are first opened. */
  comments: Record<string, CommentsState>;
}

const initialState: PostsState = {
  items: [],
  nextCursor: null,
  status: 'idle',
  loadingMore: false,
  error: null,
  comments: {},
};

function flipLike(post: Post) {
  post.likedByMe = !post.likedByMe;
  post.likeCount += post.likedByMe ? 1 : -1;
}

const postsSlice = createSlice({
  name: 'posts',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchFeed.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(fetchFeed.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.items = action.payload.items;
        state.nextCursor = action.payload.nextCursor;
      })
      .addCase(fetchFeed.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload ?? 'Could not load posts';
      })
      .addCase(fetchMorePosts.pending, (state) => {
        state.loadingMore = true;
      })
      .addCase(fetchMorePosts.fulfilled, (state, action) => {
        state.loadingMore = false;
        // Skip anything already shown (e.g. after posting, ids shift between pages).
        const seen = new Set(state.items.map((p) => p.id));
        state.items.push(...action.payload.items.filter((p) => !seen.has(p.id)));
        state.nextCursor = action.payload.nextCursor;
      })
      .addCase(fetchMorePosts.rejected, (state) => {
        state.loadingMore = false;
      })
      .addCase(createPost.fulfilled, (state, action) => {
        state.items.unshift(action.payload);
      })
      .addCase(deletePost.fulfilled, (state, action) => {
        state.items = state.items.filter((p) => p.id !== action.payload);
        delete state.comments[action.payload];
      })
      .addCase(toggleLike.pending, (state, action) => {
        const post = state.items.find((p) => p.id === action.meta.arg);
        if (post) flipLike(post);
      })
      .addCase(toggleLike.fulfilled, (state, action) => {
        // The server's numbers win: they include other people's likes since the feed loaded.
        const post = state.items.find((p) => p.id === action.meta.arg);
        if (post) Object.assign(post, action.payload);
      })
      .addCase(toggleLike.rejected, (state, action) => {
        const post = state.items.find((p) => p.id === action.meta.arg);
        if (post) flipLike(post);
      })
      .addCase(fetchComments.pending, (state, action) => {
        const current = state.comments[action.meta.arg];
        state.comments[action.meta.arg] = { items: current?.items ?? [], status: 'loading', error: null };
      })
      .addCase(fetchComments.fulfilled, (state, action) => {
        state.comments[action.meta.arg] = { items: action.payload, status: 'succeeded', error: null };
      })
      .addCase(fetchComments.rejected, (state, action) => {
        state.comments[action.meta.arg] = { items: [], status: 'failed', error: action.payload ?? 'Could not load comments' };
      })
      .addCase(addComment.fulfilled, (state, action) => {
        const { postId } = action.meta.arg;
        state.comments[postId]?.items.push(action.payload.comment);
        const post = state.items.find((p) => p.id === postId);
        if (post) post.commentCount = action.payload.commentCount;
      })
      .addCase(deleteComment.fulfilled, (state, action) => {
        const { postId, commentId } = action.meta.arg;
        const thread = state.comments[postId];
        if (thread) thread.items = thread.items.filter((c) => c.id !== commentId);
        const post = state.items.find((p) => p.id === postId);
        if (post) post.commentCount = action.payload.commentCount;
      });
  },
});

export const postsReducer = postsSlice.reducer;
