import { Schema } from "effect";

export class ProxyError extends Schema.TaggedError<ProxyError>()("ProxyError", {
  message: Schema.String,
  status: Schema.Number,
}) {
  static from(message: string, status = 502): ProxyError {
    return new ProxyError({ message, status });
  }
}

export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  message: Schema.String,
}) {}
