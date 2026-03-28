import {
  fetchFloatplaneResource,
  type FloatplaneFetchedResource
} from "./floatplane-http.js";

export interface BrowserFetchedResource extends FloatplaneFetchedResource {}

export class FloatplaneBrowserPlayback {
  async fetchResource(url: string): Promise<BrowserFetchedResource> {
    return fetchFloatplaneResource(url, {
      accept: "application/x-mpegURL,application/vnd.apple.mpegurl,*/*"
    });
  }
}

export const floatplaneBrowserPlayback = new FloatplaneBrowserPlayback();

export async function fetchPlaybackResource(url: string): Promise<BrowserFetchedResource> {
  return floatplaneBrowserPlayback.fetchResource(url);
}
