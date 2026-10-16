import { callApiServices } from '../callApiServices';
import type { FeedPage, LikeResult, Post, PostComment, PraisePayload } from '../../types/post';

export function listPostsRequest(cursor?: string) {
  return callApiServices<FeedPage>('/posts', 'get', true, cursor ? { cursor } : undefined);
}

export function createPostRequest(body: string, praise?: PraisePayload) {
  return callApiServices<Post>('/posts', 'post', true, praise ? { body, praise } : { body });
}

export function deletePostRequest(id: string) {
  return callApiServices<{ id: string; deleted: boolean }>(`/posts/${id}`, 'delete', true);
}

export function toggleLikeRequest(id: string) {
  return callApiServices<LikeResult>(`/posts/${id}/like`, 'post', true);
}

export function listCommentsRequest(postId: string) {
  return callApiServices<PostComment[]>(`/posts/${postId}/comments`, 'get', true);
}

export function createCommentRequest(postId: string, body: string) {
  return callApiServices<{ comment: PostComment; commentCount: number }>(`/posts/${postId}/comments`, 'post', true, { body });
}

export function deleteCommentRequest(postId: string, commentId: string) {
  return callApiServices<{ id: string; deleted: boolean; commentCount: number }>(`/posts/${postId}/comments/${commentId}`, 'delete', true);
}
