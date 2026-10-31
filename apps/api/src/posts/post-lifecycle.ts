import { Injectable, Logger } from '@nestjs/common';
import { type PostRow } from './posts.service';

/** What a listener learns about an edited post: it re-reads the current state itself. */
export interface PostUpdatedEvent {
  postId: string;
}

/** The row as it was deleted (status and version at deletion time). */
export interface PostDeletedEvent {
  post: Pick<PostRow, 'id' | 'status' | 'version' | 'scheduledAt'>;
}

export interface PostLifecycleListener {
  /** After `PUT /posts/:id` committed (the version was bumped). Errors reach the caller. */
  onPostUpdated?(event: PostUpdatedEvent): Promise<void>;
  /** After `DELETE /posts/:id` committed. Errors are logged and swallowed: the post is gone. */
  onPostDeleted?(event: PostDeletedEvent): Promise<void>;
}

/**
 * Tiny in-process hook point so the posts module can tell the scheduler about edits and
 * deletions without importing it (SchedulingModule imports PostsModule, never the other
 * way round). `SchedulingService` registers itself on module init.
 */
@Injectable()
export class PostLifecycle {
  private readonly logger = new Logger(PostLifecycle.name);
  private readonly listeners: PostLifecycleListener[] = [];

  register(listener: PostLifecycleListener): void {
    this.listeners.push(listener);
  }

  async emitUpdated(event: PostUpdatedEvent): Promise<void> {
    for (const listener of this.listeners) await listener.onPostUpdated?.(event);
  }

  async emitDeleted(event: PostDeletedEvent): Promise<void> {
    for (const listener of this.listeners) {
      try {
        await listener.onPostDeleted?.(event);
      } catch (err) {
        this.logger.warn({ postId: event.post.id, err }, 'Post deleted hook failed');
      }
    }
  }
}
