import {
  InvalidCommandCausationIdError,
  InvalidCommandCorrelationIdError,
  InvalidCommandIdError,
  SerializationError,
} from '../kernel/errors.js';
import { uuidv7 } from '../kernel/uuid.js';
import {
  businessFields,
  freezeMetadata,
  type Metadata,
  type MetadataValue,
  ownStatic,
  rehydrateMessage,
  requireUuid,
  toJsonData,
} from './message.js';

/** Optional envelope values for a new command. Anything left out gets its default. */
export interface CommandInit {
  readonly id?: string;
  readonly correlationId?: string;
  readonly causationId?: string | null;
  readonly metadata?: Metadata;
  readonly timestamp?: Date;
}

/** The complete envelope of a command. */
export interface CommandEnvelope {
  readonly id: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly metadata: Metadata;
  readonly timestamp: Date;
}

/** The transport shape of a command, for queue messages (§4.3). */
export interface SerializedCommand {
  readonly command_id: string;
  readonly command_type: string;
  readonly causation_id: string | null;
  readonly correlation_id: string;
  readonly data: Record<string, unknown>;
  readonly metadata: Record<string, MetadataValue>;
  readonly timestamp: string;
}

/** A concrete command class. Its static `commandName` is optional. */
export type CommandClass<C extends Command = Command> = (abstract new (...args: never[]) => C) & {
  readonly commandName?: string;
};

const ENVELOPE_KEYS: ReadonlySet<string> = new Set(['id', 'correlationId', 'causationId', 'metadata', 'timestamp']);

/** The command type name: the class's own static `commandName`, or else the class name. */
export function commandNameOf(commandClass: CommandClass): string {
  const name = ownStatic(commandClass, 'commandName');
  return typeof name === 'string' ? name : commandClass.name;
}

/**
 * An immutable intent to change the system's state (§2.2). Unlike an event, it can be rejected.
 *
 * Declared like an event: business fields as constructor parameters, then an optional
 * {@link CommandInit}. Set `static override readonly commandName` when builds are minified;
 * the name is how queue messages find the class again.
 */
export abstract class Command {
  declare static readonly commandName?: string;

  readonly id: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly metadata: Metadata;
  readonly timestamp: Date;

  constructor(init: CommandInit = {}) {
    this.id = init.id === undefined ? uuidv7() : requireUuid(init.id, 'id', InvalidCommandIdError);
    this.correlationId =
      init.correlationId === undefined
        ? uuidv7()
        : requireUuid(init.correlationId, 'correlationId', InvalidCommandCorrelationIdError);
    this.causationId =
      init.causationId == null
        ? null
        : requireUuid(init.causationId, 'causationId', InvalidCommandCausationIdError);
    this.metadata = freezeMetadata(init.metadata);
    this.timestamp = init.timestamp ?? new Date();
  }

  get commandName(): string {
    return commandNameOf(this.constructor as CommandClass);
  }

  serialize(): SerializedCommand {
    return {
      command_id: this.id,
      command_type: this.commandName,
      causation_id: this.causationId,
      correlation_id: this.correlationId,
      data: toJsonData(businessFields(this, ENVELOPE_KEYS), `Command ${this.commandName}`),
      metadata: { ...this.metadata },
      timestamp: this.timestamp.toISOString(),
    };
  }

  /** Builds a command of this class from stored data without calling its constructor. Frozen. */
  static rehydrate<C extends Command>(
    this: CommandClass<C>,
    data: Readonly<Record<string, unknown>>,
    envelope: CommandEnvelope,
  ): C {
    if ((this as unknown) === Command) {
      throw new SerializationError('Call rehydrate() on a concrete command class, not on Command');
    }
    const validated: CommandEnvelope = {
      id: requireUuid(envelope.id, 'id', InvalidCommandIdError),
      correlationId: requireUuid(envelope.correlationId, 'correlationId', InvalidCommandCorrelationIdError),
      causationId:
        envelope.causationId === null
          ? null
          : requireUuid(envelope.causationId, 'causationId', InvalidCommandCausationIdError),
      metadata: freezeMetadata(envelope.metadata),
      timestamp: new Date(envelope.timestamp.getTime()),
    };
    return rehydrateMessage(this.prototype, validated, data, ENVELOPE_KEYS, `Command ${commandNameOf(this)}`);
  }
}

/** The envelope of a serialized command. */
export function envelopeFromSerializedCommand(serialized: SerializedCommand): CommandEnvelope {
  const timestamp = new Date(serialized.timestamp);
  if (Number.isNaN(timestamp.getTime())) {
    throw new SerializationError(`Command ${serialized.command_id} has an invalid timestamp`, {
      context: { commandId: serialized.command_id, timestamp: serialized.timestamp },
    });
  }
  return {
    id: serialized.command_id,
    correlationId: serialized.correlation_id,
    causationId: serialized.causation_id,
    metadata: serialized.metadata,
    timestamp,
  };
}
