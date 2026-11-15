import config from '../config.js';
import { getPlayerHosts, PlayerHosts, siteAjax } from '../fetch.js';
import { validationError } from '../utils/errors.js';

export type ServerType = 'sub' | 'dub';

export interface ServerJson {
  serverId?: string;
  serverName?: string;
  index?: number;
}

export interface ServerPayload {
  sub?: ServerJson[];
  dub?: ServerJson[];
  raw?: ServerJson[];
}

export interface ServerEntry {
  serverName: string | null;
  serverId: string | null;
  m3u8: string | null;
  iframe: string;
}

export interface ServersResponse {
  episodeId: string;
  type: ServerType;
  servers: ServerEntry[];
}

const PLAYER_RESOLVE_TIMEOUT_MS = 5000;

const resolveM3u8Url = async (embedUrl: string, hosts: PlayerHosts): Promise<string | null> => {
  try {
    const playerUrl = new URL(embedUrl);
    const allowedOrigins = new Set(Object.values(hosts).map(host => new URL(host).origin));
    if (playerUrl.protocol !== 'https:' || !allowedOrigins.has(playerUrl.origin)) return null;

    const playerResponse = await fetch(playerUrl, {
      headers: {
        'User-Agent': config.headers['User-Agent'],
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(PLAYER_RESOLVE_TIMEOUT_MS),
      redirect: 'error',
    });
    if (!playerResponse.ok) return null;

    const html = await playerResponse.text();
    const endpointMatch = html.match(/sourcesUrl\s*=\s*['"]([^'"]+)['"]/i);
    if (!endpointMatch) return null;

    const sourcesUrl = new URL(endpointMatch[1], playerUrl);
    if (sourcesUrl.origin !== playerUrl.origin) return null;

    const sourcesResponse = await fetch(sourcesUrl, {
      headers: {
        'User-Agent': config.headers['User-Agent'],
        Accept: 'application/json',
        Referer: playerUrl.toString(),
      },
      signal: AbortSignal.timeout(PLAYER_RESOLVE_TIMEOUT_MS),
      redirect: 'error',
    });
    if (!sourcesResponse.ok) return null;

    const payload = (await sourcesResponse.json()) as {
      sources?: Array<{ file?: unknown; type?: unknown }>;
    };
    const source = payload.sources?.find(
      item =>
        typeof item.file === 'string' &&
        (String(item.type).toLowerCase() === 'hls' || /\.m3u8(?:$|\?)/i.test(item.file))
    );
    if (!source || typeof source.file !== 'string') return null;

    const mediaUrl = new URL(source.file, playerUrl);
    return mediaUrl.protocol === 'https:' ? mediaUrl.toString() : null;
  } catch {
    return null;
  }
};

export const buildEmbedUrl = (
  hosts: PlayerHosts,
  serverName: string,
  episodeId: string,
  type: ServerType,
  aniId?: string | null,
  malId?: string | null,
  fxId?: string | null,
  episodeNumber?: number
): string => {
  const { flixera, cdn, zcdn } = hosts;
  let base: string;
  let useFlixeraQuery = false;

  if (serverName === 's-1') {
    useFlixeraQuery = true;
    if (aniId) base = `${flixera}/embed/ani/${aniId}/${type}`;
    else if (malId) base = `${flixera}/embed/mal/${malId}/${type}`;
    else if (fxId) base = `${flixera}/embed/${fxId}`;
    else base = `${flixera}/embed/ani/${episodeId}/${type}`;
  } else if (serverName === 's-2') {
    useFlixeraQuery = true;
    base = `${zcdn}/e/${episodeId}/${type}`;
  } else if (serverName === 's-3') {
    if (aniId) base = `${cdn}/embed/hd-2/ani/${aniId}/${type}`;
    else if (malId) base = `${cdn}/embed/hd-2/mal/${malId}/${type}`;
    else base = `${cdn}/embed/hd-2/${episodeId}/${type}`;
  } else if (serverName === 's-4') {
    const aniBits = String(aniId || '').split('/');
    const malBits = String(malId || '').split('/');
    const epNum = parseInt(aniBits[1] || malBits[1] || String(episodeNumber || 1), 10) || 1;
    if (aniBits[0]) base = `${cdn}/embed/ani/${aniBits[0]}/${epNum}/hsub`;
    else if (malBits[0]) base = `${cdn}/embed/mal/${malBits[0]}/${epNum}/hsub`;
    else base = `${cdn}/embed/hd-1/${episodeId}/hsub`;
  } else {
    useFlixeraQuery = true;
    if (aniId) base = `${flixera}/embed/ani/${aniId}/${type}`;
    else if (malId) base = `${flixera}/embed/mal/${malId}/${type}`;
    else base = `${flixera}/embed/ani/${episodeId}/${type}`;
  }

  return useFlixeraQuery
    ? `${base}?autoplay=0&skipintro=0&skipoutro=0`
    : `${base}?k=1&autoPlay=0&skipIntro=0&skipOutro=0`;
};

export const extractServers = (
  payload: ServerPayload,
  episodeId: string,
  type: ServerType,
  hosts: PlayerHosts,
  aniId?: string | null,
  malId?: string | null,
  fxId?: string | null
): ServersResponse => {
  const list =
    (type === 'dub' ? payload.dub : type === 'sub' ? payload.sub : payload.raw) ||
    payload.sub ||
    [];
  return {
    episodeId,
    type,
    servers: list.map(entry => ({
      serverName: entry.serverName || null,
      serverId: entry.serverId || null,
      m3u8: null,
      iframe: buildEmbedUrl(hosts, entry.serverName || '', episodeId, type, aniId, malId, fxId),
    })),
  };
};

export const getServers = async (
  episodeId: string,
  type: ServerType,
  ani?: string | null,
  mal?: string | null,
  fx?: string | null
): Promise<ServersResponse> => {
  const sub = type === 'sub' ? 1 : 0;
  const dub = type === 'dub' ? 1 : 0;
  let payload: ServerPayload;
  try {
    payload = await siteAjax<ServerPayload>(
      `/ajax/server?episodeId=${encodeURIComponent(episodeId)}&sub=${sub}&dub=${dub}`
    );
  } catch (err: unknown) {
    throw new validationError(
      err instanceof Error ? err.message : 'make sure the episodeId is correct'
    );
  }
  const hosts = await getPlayerHosts();
  const response = extractServers(payload, episodeId, type, hosts, ani, mal, fx);
  const servers = await Promise.all(
    response.servers.map(async server => ({
      ...server,
      m3u8: await resolveM3u8Url(server.iframe, hosts),
    }))
  );
  return { ...response, servers };
};
