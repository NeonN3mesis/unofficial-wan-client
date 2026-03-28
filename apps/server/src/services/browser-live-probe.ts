import { serverConfig } from "../config.js";
import type { FloatplaneApiProbePayload } from "./capture-artifacts.js";
import { fetchFloatplaneJson } from "./floatplane-http.js";

type ProbeResponse<T> = {
  status: number;
  ok: boolean;
  url: string;
  data: T;
};

function extractLiveStreamId(payload: unknown): string | undefined {
  if (!Array.isArray(payload) || payload.length === 0) {
    return undefined;
  }

  const creator = payload[0] as { liveStream?: { id?: string } } | undefined;
  return creator?.liveStream?.id;
}

export class BrowserLiveProbeService {
  private probePromise?: Promise<FloatplaneApiProbePayload | null>;
  private cachedProbe?: FloatplaneApiProbePayload;
  private cachedAt = 0;

  private async executeProbe(): Promise<FloatplaneApiProbePayload | null> {
    const creatorNamed = await fetchFloatplaneJson<unknown>(
      "https://www.floatplane.com/api/v3/creator/named?creatorURL%5B0%5D=linustechtips"
    ) as ProbeResponse<unknown>;
    const creatorList = await fetchFloatplaneJson<unknown>(
      "https://www.floatplane.com/api/v3/content/creator/list",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          ids: ["59f94c0bdd241b70349eb72b"],
          limit: 20
        })
      }
    ) as ProbeResponse<unknown>;

    const liveStreamId = extractLiveStreamId(creatorNamed?.data);
    const deliveryInfoLive =
      liveStreamId
        ? ((await fetchFloatplaneJson<unknown>(
            `https://www.floatplane.com/api/v3/delivery/info?scenario=live&entityId=${encodeURIComponent(
              liveStreamId
            )}&entityKind=livestream`
          )) as ProbeResponse<unknown>)
        : undefined;
    const deliveryInfoLiveFallback =
      liveStreamId
        ? ((await fetchFloatplaneJson<unknown>(
            `https://www.floatplane.com/api/v3/delivery/info?scenario=live&entityId=${encodeURIComponent(
              liveStreamId
            )}`
          )) as ProbeResponse<unknown>)
        : undefined;

    return {
      generatedAt: new Date().toISOString(),
      creatorNamed,
      creatorList,
      deliveryInfoLive,
      deliveryInfoLiveFallback
    };
  }

  async probeWanLive(force = false): Promise<FloatplaneApiProbePayload | null> {
    if (!force && this.cachedProbe && Date.now() - this.cachedAt < serverConfig.liveProbeCacheMs) {
      return this.cachedProbe;
    }

    if (this.probePromise) {
      return this.probePromise;
    }

    this.probePromise = this.executeProbe()
      .then((nextProbe) => {
        if (nextProbe) {
          this.cachedProbe = nextProbe;
          this.cachedAt = Date.now();
        }

        return nextProbe;
      })
      .catch(() => this.cachedProbe ?? null)
      .finally(() => {
        this.probePromise = undefined;
      });

    return this.probePromise;
  }
}

export const browserLiveProbeService = new BrowserLiveProbeService();
