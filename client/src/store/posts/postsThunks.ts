import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  createCommentRequest,
  createPostRequest,
  deleteCommentRequest,
  deletePostRequest,
  listCommentsRequest,
  listPostsRequest,
  toggleLikeRequest,
} from '../../services/endpoints/posts.endpoints';
import type { FeedPage, LikeResult, Post, PostComment, PraisePayload } from '../../types/post';
import { ApiError, type ValidationDetails } from '../../types/api';
import { errorMessage } from '../thunkError';

/** The first page (a fresh feed). */
export const fetchFeed = createAsyncThunk<FeedPage, void, { rejectValue: string }>('posts/fetchFeed', async (_, { rejectWithValue }) => {
  try {
    const { data } = await listPostsRequest();
    return data;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const fetchMorePosts = createAsyncThunk<FeedPage, string, { rejectValue: string }>(
  'posts/fetchMore',
  async (cursor, { rejectWithValue }) => {
    try {
      const { data } = await listPostsRequest(cursor);
      return data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

/** A post, or with `praise` a praise of 1–5 colleagues. */
export const createPost = createAsyncThunk<Post, { body: string; praise?: PraisePayload }, { rejectValue: string }>(
  'posts/create',
  async ({ body, praise }, { rejectWithValue }) => {
    try {
      const { data } = await createPostRequest(body, praise);
      return data;
    } catch (err) {
      return rejectWithValue(praiseErrorMessage(err));
    }
  }
);

/** The server's own words for a refused praise ("You can't praise yourself"), else the usual message. */
function praiseErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const praise = (err.details as ValidationDetails | undefined)?.fieldErrors?.praise;
    if (praise?.length) return praise[0];
  }
  return errorMessage(err);
}

export const deletePost = createAsyncThunk<string, string, { rejectValue: string }>('posts/delete', async (id, { rejectWithValue }) => {
  try {
    await deletePostRequest(id);
    return id;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/** The slice flips the like as soon as this starts, and puts it back if it fails. */
export const toggleLike = createAsyncThunk<LikeResult, string, { rejectValue: string }>('posts/toggleLike', async (id, { rejectWithValue }) => {
  try {
    const { data } = await toggleLikeRequest(id);
    return data;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const fetchComments = createAsyncThunk<PostComment[], string, { rejectValue: string }>(
  'posts/fetchComments',
  async (postId, { rejectWithValue }) => {
    try {
      const { data } = await listCommentsRequest(postId);
      return data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

export const addComment = createAsyncThunk<
  { comment: PostComment; commentCount: number },
  { postId: string; body: string },
  { rejectValue: string }
>('posts/addComment', async ({ postId, body }, { rejectWithValue }) => {
  try {
    const { data } = await createCommentRequest(postId, body);
    return data;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const deleteComment = createAsyncThunk<
  { commentCount: number },
  { postId: string; commentId: string },
  { rejectValue: string }
>('posts/deleteComment', async ({ postId, commentId }, { rejectWithValue }) => {
  try {
    const { data } = await deleteCommentRequest(postId, commentId);
    return { commentCount: data.commentCount };
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});
