import { songKey } from '@shared/track';
import type { ArtistRef, ArtistSummary, SearchResults, Track } from '@shared/types';
import type { SpotapleApi } from '@shared/api';

const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const sameArtist = (left: ArtistRef, right: ArtistRef) =>
  (left.id !== undefined && left.id === right.id) || normalize(left.name) === normalize(right.name);

function matchingArtist(results: SearchResults, query: string): ArtistRef | undefined {
  const songs = results.songs.slice(0, 10);
  const candidates = [...results.artists.slice(0, 8), ...songs.flatMap((song) => song.artists.slice(0, 1))];
  const initials = query.replaceAll(' ', '');
  const acronym = /^[a-z]{2,5}$/.test(initials) && (query === initials || query.split(' ').every((word) => word.length === 1));
  const scored = candidates.map((artist, index) => {
    const name = normalize(artist.name);
    const words = name.split(' ');
    const short = acronym && words.length >= initials.length &&
      words.slice(0, initials.length).map((word) => word[0]).join('') === initials;
    const match = name === query ? 44 : name.startsWith(`${query} `) ? 36 : short ? 38 : 0;
    const support = songs.filter((song) => song.artists.some((credit) => sameArtist(artist, credit))).length;
    return { artist, score: match && (support || index < 2 || name === query ? match + 6 * support - 3 * index : 0) };
  });
  return scored.filter(({ score }) => score > 0).sort((a, b) => b.score - a.score)[0]?.artist;
}

export interface SearchDiscovery {
  artists: ArtistSummary[];
  songs: Track[];
}

export async function discoverSearch(
  results: SearchResults,
  music: Pick<SpotapleApi['music'], 'artist' | 'radio'>,
  current: () => boolean,
  onUpdate?: (discovery: SearchDiscovery) => void,
): Promise<SearchDiscovery | undefined> {
  const query = normalize(results.query);
  if (query.replaceAll(' ', '').length < 2) return;
  const artist = matchingArtist(results, query);
  const exactSong = results.songs.find((song) => normalize(song.title) === query);
  const artistSong = artist && results.songs.find((song) => song.artists.some((credit) => sameArtist(artist, credit)));
  const direct = artist ? artistSong : exactSong ??
    results.songs.find((song) => normalize(song.title).startsWith(`${query} `));
  const primary = artist ?? direct?.artists[0];
  const artistId = primary?.id ?? artist?.id;
  if (!artistId && !direct) return;

  let profile: Awaited<ReturnType<typeof music.artist>> | undefined;
  let recommended: Track[] = [];
  const publish = () => {
    if (!current()) return;
    const discovery = buildDiscovery(results, primary, profile?.similar ?? [], recommended);
    if (discovery) onUpdate?.(discovery);
    return discovery;
  };
  const details = artistId ? music.artist(artistId).catch(() => undefined).then((value) => {
    profile = value;
    publish();
    return value;
  }) : Promise.resolve(undefined);
  const seeds = direct ? Promise.resolve(direct) : details.then((value) => value?.topSongs[0]);
  const recommendations = seeds.then((seed) => seed && current()
    ? music.radio(seed, results.songs.slice(0, 100).map((song) => song.id)).catch(() => [])
    : []).then((tracks) => {
      recommended = tracks;
      publish();
    });
  await Promise.all([details, recommendations]);
  return current() ? buildDiscovery(results, primary, profile?.similar ?? [], recommended) : undefined;
}

function buildDiscovery(results: SearchResults, source: ArtistRef | undefined, similar: ArtistSummary[], recommended: Track[]): SearchDiscovery | undefined {
  const artists: ArtistSummary[] = [];
  const seenArtists: ArtistRef[] = [...results.artists];
  if (source) seenArtists.push(source);
  const addArtist = (artist: ArtistSummary) => {
    if (artists.length >= 6 || seenArtists.some((entry) => sameArtist(artist, entry))) return;
    seenArtists.push(artist);
    artists.push(artist);
  };

  const seenIds = new Set(results.songs.map((song) => song.id));
  const seenSongs = new Set(results.songs.map(songKey));
  const songs: Track[] = [];
  for (const song of recommended) {
    const key = songKey(song);
    if (!song.artists.length || (source && sameArtist(song.artists[0]!, source)) || seenIds.has(song.id) || seenSongs.has(key)) continue;
    seenIds.add(song.id);
    seenSongs.add(key);
    songs.push(song);
    if (songs.length === 6) break;
  }
  // Se reservan lugares para los artistas de las canciones recomendadas y los del perfil.
  similar.slice(0, 2).forEach(addArtist);
  for (const song of songs.slice(0, 4)) {
    const credit = song.artists[0]!;
    if (credit.id) addArtist(similar.find((entry) => sameArtist(credit, entry)) ?? { id: credit.id, name: credit.name });
  }
  similar.forEach(addArtist);
  return songs.length || artists.length ? { songs, artists } : undefined;
}
