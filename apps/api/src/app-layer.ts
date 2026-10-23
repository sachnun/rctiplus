import { Layer } from "effect";
import { Cache } from "./cache.js";
import { CdnProxy } from "./hls.js";
import { HistoryService } from "./history.js";
import { RctiApi } from "./rctiplus.js";
import { Routes } from "./routes.js";
import { ScheduleService } from "./schedule.js";
import { TokenManager } from "./token.js";

const InfraLayer = Layer.mergeAll(Cache.layer, TokenManager.layer);

const ApiLayer = RctiApi.layer.pipe(Layer.provideMerge(InfraLayer));

const CdnLayer = CdnProxy.layer.pipe(Layer.provideMerge(InfraLayer), Layer.provideMerge(ApiLayer));

const ScheduleLayer = ScheduleService.layer.pipe(Layer.provideMerge(InfraLayer));

const HistoryLayer = HistoryService.layer.pipe(
  Layer.provideMerge(InfraLayer),
  Layer.provideMerge(ApiLayer),
  Layer.provideMerge(ScheduleLayer)
);

const RoutesLayer = Routes.layer.pipe(
  Layer.provideMerge(ApiLayer),
  Layer.provideMerge(CdnLayer),
  Layer.provideMerge(ScheduleLayer),
  Layer.provideMerge(HistoryLayer)
);

/** Every service the HTTP layer needs, fully wired. */
export const AppLayer = Layer.mergeAll(
  InfraLayer,
  ApiLayer,
  CdnLayer,
  ScheduleLayer,
  HistoryLayer,
  RoutesLayer
);
