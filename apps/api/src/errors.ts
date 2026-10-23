import { Schema } from "effect";

/** Upstream failure carrying the HTTP status the proxy should answer with. */
export class ProxyError extends Schema.TaggedError<ProxyError>()("ProxyError", {
  message: Schema.String,
  status: Schema.Number,
}) {
  static from(message: string, status = 502): ProxyError {
    return new ProxyError({ message, status });
  }
}

/** A request that does not match any known route. */
export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  message: Schema.String,
}) {}
