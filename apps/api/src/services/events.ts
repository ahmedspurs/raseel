import type { Redis } from 'ioredis'

export const EVENTS_CHANNEL = 'raseel:events'

/** Realtime events. The API relays them to connected agents. */
export type RealtimeEvent =
  | { type: 'message.created'; conversationId: string; messageId: string }
  | { type: 'message.updated'; conversationId: string; messageId: string }
  | { type: 'conversation.updated'; conversationId: string }
  | { type: 'note.created'; conversationId: string; noteId: string }
  | { type: 'mention.created'; conversationId: string; noteId: string; userId: string }
  | { type: 'task.due'; taskId: string; userId: string; title: string }

/** Publishes over Redis so events raised by the worker reach the API process. */
export class EventBus {
  constructor(private readonly redis: Redis) {}

  async publish(event: RealtimeEvent): Promise<void> {
    await this.redis.publish(EVENTS_CHANNEL, JSON.stringify(event))
  }
}
