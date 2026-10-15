import type { MetadataValue } from './message.js';

/** The storage and transport shape of a domain event (§2.1). Plain data, safe to JSON-encode. */
export interface SerializedEvent {
  readonly event_id: string;
  readonly event_type: string;
  readonly event_version: string;
  readonly causation_id: string | null;
  readonly correlation_id: string;
  /** The business fields. */
  readonly data: Record<string, unknown>;
  readonly metadata: Record<string, MetadataValue>;
  /** ISO 8601, with milliseconds. */
  readonly occurred_at: string;
}
