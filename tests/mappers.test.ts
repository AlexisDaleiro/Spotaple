import { describe, expect, it } from 'vitest';
import { classify, MESSAGES, playabilityError, withTimeout } from '../src/main/music/youtube/errors';
import { bestThumb, isTrackItem, mapAlbum, mapArtist, mapPlaylistTrack, mapRemotePlaylist, mapTrack, parseTrackCount, searchItems, txt } from '../src/main/music/youtube/mappers';
import { evaluatePlayerScript } from '../src/main/music/youtube/eval';
import { withoutCredentials } from '../src/main/net-fetch';

/** Nodos simulados con la forma verificada de youtubei.js 18.3.0. */
const text = (s: string) => ({ toString: () => s });
const flex = (...cols: string[]) => cols.map((c) => ({ title: text(c) }));

describe('mapRemotePlaylist', () => {
  it('playlist de búsqueda: id con prefijo VL, autor y la portada más grande', () => {
    expect(
      mapRemotePlaylist({
        id: 'VLPLwO8Yaz8URbq0HdSG3VFeCIUSGpsjbCtH',
        item_type: 'playlist',
        title: 'Every Daft Punk Song',
        author: { name: 'Adam Is very weird', channel_id: 'UCx1' },
        flex_columns: flex('Every Daft Punk Song', 'Adam Is very weird • 281K views'),
        thumbnails: [
          { url: 'https://yt3.googleusercontent.com/abc=s192', width: 192 },
          { url: 'https://yt3.googleusercontent.com/abc=s1200', width: 1200 },
        ],
      }),
    ).toEqual({
      id: 'VLPLwO8Yaz8URbq0HdSG3VFeCIUSGpsjbCtH',
      title: 'Every Daft Punk Song',
      author: 'Adam Is very weird',
      thumbnail: 'https://yt3.googleusercontent.com/abc=s1200',
    });
  });

  it('sin author: el nombre sale de la 2.ª columna, sin las reproducciones', () => {
    const p = mapRemotePlaylist({
      id: 'VLPL0BKTsqcDLNFhlmyCUzRyYEF6ox9PI1z5',
      item_type: 'playlist',
      title: 'Daft Punk (Instrumental)',
      flex_columns: flex('Daft Punk (Instrumental)', 'Rahmadia Kushardiani • 12K views'),
    });
    expect(p!.author).toBe('Rahmadia Kushardiani');
  });

  it('sin autor en ningún lado no inventa uno; la portada de video 16:9 se conserva', () => {
    const p = mapRemotePlaylist({
      id: 'VLPL4Z-wH5VI-MORfue9WSgU8E25tKEoqieM',
      item_type: 'playlist',
      title: 'Solo título',
      flex_columns: flex('Solo título'),
      thumbnails: [{ url: 'https://i.ytimg.com/vi/qxCSOaJG7fg/sddefault.jpg', width: 640 }],
    });
    expect(p!.author).toBeUndefined();
    expect(p!.thumbnail).toBe('https://i.ytimg.com/vi/qxCSOaJG7fg/sddefault.jpg');
  });

  it('rechaza lo que no es una playlist usable', () => {
    const ok = { id: 'VLPLwO8Yaz8URbq0HdSG3VFeCIUSGpsjbCtH', item_type: 'playlist', title: 'X' };
    expect(mapRemotePlaylist(ok)).not.toBeNull();
    expect(mapRemotePlaylist({ ...ok, item_type: 'album' })).toBeNull();
    expect(mapRemotePlaylist({ ...ok, id: '../../etc' })).toBeNull();
    expect(mapRemotePlaylist({ ...ok, id: 'x' })).toBeNull();
    expect(mapRemotePlaylist({ ...ok, title: '' })).toBeNull();
    expect(mapRemotePlaylist(null)).toBeNull();
  });
});

describe('mapPlaylistTrack', () => {
  it('ítem tipado como video: id, duración y artista de authors', () => {
    expect(
      mapPlaylistTrack({
        item_type: 'video',
        id: 'yuoghR-5-Xs',
        title: 'Daftendirekt',
        duration: { seconds: 165 },
        authors: [{ name: 'Daft Punk', channel_id: 'UCRr1xG' }],
        thumbnails: [{ url: 'https://i.ytimg.com/vi/yuoghR-5-Xs/hqdefault.jpg', width: 400 }],
      }),
    ).toEqual({
      id: 'yuoghR-5-Xs',
      title: 'Daftendirekt',
      artists: [{ id: 'UCRr1xG', name: 'Daft Punk' }],
      durationSec: 165,
      thumbnail: 'https://i.ytimg.com/vi/yuoghR-5-Xs/hqdefault.jpg',
    });
  });

  it('ítem de tipo desconocido (videos de canal): el id sale del overlay, la duración de la columna fija y el artista de la 2.ª columna', () => {
    const t = mapPlaylistTrack({
      item_type: 'unknown',
      title: 'Breathe the Air',
      overlay: { content: { endpoint: { payload: { videoId: '1ZNBxNpHZGc' } } } },
      flex_columns: flex('Breathe the Air', 'Gentle Lo-Fi Days', 'N/A'),
      fixed_columns: flex('1:53:55'),
    });
    expect(t!.id).toBe('1ZNBxNpHZGc');
    expect(t!.durationSec).toBe(6835);
    expect(t!.artists).toEqual([{ name: 'Gentle Lo-Fi Days' }]);
  });

  it('duración en m:ss y texto que no es una duración', () => {
    const item = (fixed: string) => ({
      item_type: 'unknown',
      title: 'T',
      overlay: { content: { endpoint: { payload: { videoId: 'abcDEF12345' } } } },
      fixed_columns: flex(fixed),
    });
    expect(mapPlaylistTrack(item('2:45'))!.durationSec).toBe(165);
    expect(mapPlaylistTrack(item('0:29'))!.durationSec).toBe(29);
    expect(mapPlaylistTrack(item('N/A'))!.durationSec).toBeUndefined();
  });

  it('ítem sin video (privado o eliminado) y entradas inválidas', () => {
    expect(mapPlaylistTrack({ item_type: 'unknown', title: 'Deleted video', flex_columns: flex('Deleted video', 'N/A') })).toBeNull();
    expect(mapPlaylistTrack({})).toBeNull();
    expect(mapPlaylistTrack(null)).toBeNull();
  });
});

describe('parseTrackCount', () => {
  it('lee la cantidad de la parte «N tracks» del segundo subtítulo', () => {
    expect(parseTrackCount(['281K views', ' • ', '75 tracks', ' • ', '5 hours, 13 minutes'])).toBe(75);
    expect(parseTrackCount(['1 track'])).toBe(1);
    expect(parseTrackCount(['1,234 tracks'])).toBe(1234);
  });

  it('sin esa parte no inventa una cantidad', () => {
    expect(parseTrackCount(['3 days'])).toBeUndefined();
    expect(parseTrackCount([])).toBeUndefined();
  });
});

describe('mapTrack', () => {
  it('canción de búsqueda: artistas con id, álbum, duración y la miniatura más grande', () => {
    const t = mapTrack({
      id: 'wU26xVT_vBU',
      item_type: 'song',
      title: 'One More Time (Radio Edit)',
      artists: [{ name: 'Daft Punk', channel_id: 'UCRr1xG' }],
      album: { id: 'MPREb_7lt', name: 'One More Time' },
      duration: { text: '5:21', seconds: 321 },
      thumbnails: [
        { url: 'https://lh3.googleusercontent.com/a=w60-h60', width: 60 },
        { url: 'https://lh3.googleusercontent.com/a=w226-h226', width: 226 },
      ],
    });
    expect(t).toEqual({
      id: 'wU26xVT_vBU',
      title: 'One More Time (Radio Edit)',
      artists: [{ id: 'UCRr1xG', name: 'Daft Punk' }],
      album: { id: 'MPREb_7lt', title: 'One More Time' },
      durationSec: 321,
      thumbnail: 'https://lh3.googleusercontent.com/a=w226-h226',
    });
  });

  it('tema de álbum (respuesta incompleta: sin artistas ni portada, "N/A"): usa lo del álbum', () => {
    const t = mapTrack(
      { id: 'FGBhQbmPwH8', item_type: 'video', title: 'One More Time', duration: { seconds: 321 }, flex_columns: flex('One More Time', 'N/A', '857M plays') },
      { artists: [{ id: 'UCRr1xG', name: 'Daft Punk' }], album: { id: 'MPREb_7lt', title: 'Discovery' }, thumbnail: 'https://lh3.googleusercontent.com/cover=w544-h544' },
    );
    expect(t!.artists).toEqual([{ id: 'UCRr1xG', name: 'Daft Punk' }]);
    expect(t!.album!.title).toBe('Discovery');
    expect(t!.thumbnail).toContain('cover');
  });

  it('canción de la página del artista: el álbum sale de la 4.ª columna', () => {
    const t = mapTrack({
      id: 'khnokW3Mw24',
      item_type: 'song',
      title: 'Instant Crush',
      artists: [{ name: 'Daft Punk', channel_id: 'UC1' }, { name: 'Julian Casablancas', channel_id: 'UC2' }],
      flex_columns: flex('Instant Crush', 'Daft Punk & Julian Casablancas', '1.2B plays', 'Random Access Memories'),
    });
    expect(t!.album).toEqual({ title: 'Random Access Memories' });
    expect(t!.artists).toHaveLength(2);
  });

  it('sin artistas en ningún lado: lista vacía (la interfaz muestra "Artista desconocido")', () => {
    expect(mapTrack({ id: 'abcDEF12345', item_type: 'song', title: 'X', flex_columns: flex('X') })!.artists).toEqual([]);
  });

  it('rechaza lo que no tiene un videoId usable o título', () => {
    expect(mapTrack({ title: 'sin id' })).toBeNull();
    expect(mapTrack({ id: 'x', title: 'id corto' })).toBeNull();
    expect(mapTrack({ id: '../../../../etc', title: 'ruta' })).toBeNull();
    expect(mapTrack({ id: 'abcDEF12345' })).toBeNull();
    expect(mapTrack(null)).toBeNull();
  });

  it('los títulos largos se recortan y las miniaturas no https se ignoran', () => {
    const t = mapTrack({ id: 'abcDEF12345', item_type: 'song', title: 'x'.repeat(1000), thumbnails: [{ url: 'http://evil.example/a.png', width: 100 }] });
    expect(t!.title.length).toBeLessThanOrEqual(300);
    expect(t!.thumbnail).toBeUndefined();
  });
});

describe('mapAlbum / mapArtist', () => {
  it('álbum de búsqueda: tipo, artista y año desde "Album • Daft Punk • 2001"', () => {
    const a = mapAlbum({ id: 'MPREb_7lt', item_type: 'album', title: 'Discovery', year: '2001', flex_columns: flex('Discovery', 'Album • Daft Punk • 2001'), thumbnail: { contents: [{ url: 'https://lh3.googleusercontent.com/q=w544-h544', width: 544 }] } });
    expect(a).toMatchObject({ id: 'MPREb_7lt', title: 'Discovery', year: '2001', kind: 'Album', artists: [{ name: 'Daft Punk' }] });
    expect(a!.thumbnail).toContain('googleusercontent');
  });
  it('sencillo de la página del artista usa el artista de la página', () => {
    const a = mapAlbum({ id: 'MPREb_X1', item_type: 'album', title: 'GLBTM', subtitle: text('Single • 2023'), year: '2023', thumbnail: [{ url: 'https://lh3.googleusercontent.com/s=w226-h226', width: 226 }] }, { id: 'UC1', name: 'Daft Punk' });
    expect(a).toMatchObject({ kind: 'Single', year: '2023', artists: [{ id: 'UC1', name: 'Daft Punk' }] });
  });
  it('artista: quita el prefijo "Artist •" del subtítulo', () => {
    const a = mapArtist({ id: 'UCRr1xG', item_type: 'artist', name: 'Daft Punk', subtitle: text('Artist • 67.3M monthly audience'), thumbnail: { contents: [{ url: 'https://lh3.googleusercontent.com/p=w120-h120', width: 120 }] } });
    expect(a).toMatchObject({ id: 'UCRr1xG', name: 'Daft Punk', subtitle: '67.3M monthly audience' });
  });
  it('sin id o sin nombre se descartan', () => {
    expect(mapAlbum({ title: 'x' })).toBeNull();
    expect(mapArtist({ id: 'UC1' })).toBeNull();
  });
});

describe('utilidades de mapeo', () => {
  it('txt convierte Text, string y basura', () => {
    expect(txt(text('hola '))).toBe('hola');
    expect(txt('x')).toBe('x');
    expect(txt(undefined)).toBe('');
    expect(txt({})).toBe('');
  });
  it('bestThumb elige el ancho mayor y exige https', () => {
    expect(bestThumb([{ url: 'https://a/1', width: 10 }, { url: 'https://a/2', width: 99 }])).toBe('https://a/2');
    expect(bestThumb([{ url: 'http://a/1', width: 10 }])).toBeUndefined();
    expect(bestThumb(undefined)).toBeUndefined();
    expect(bestThumb([])).toBeUndefined();
  });
  it('searchItems aplana secciones y tolera respuestas vacías', () => {
    expect(searchItems({ contents: [{ contents: [1, 2] }, { contents: [3] }, {}] })).toEqual([1, 2, 3]);
    expect(searchItems(undefined)).toEqual([]);
    expect(isTrackItem({ item_type: 'song' })).toBe(true);
    expect(isTrackItem({ item_type: 'album' })).toBe(false);
  });
});

describe('errores', () => {
  it('clasifica fallos de conexión', () => {
    for (const e of [
      Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }),
      Object.assign(new Error('x'), { code: 'ECONNRESET' }),
      Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
    ]) {
      expect(classify(e).code).toBe('network');
    }
    expect(classify(new Error('fetch failed')).message).toBe(MESSAGES.network);
  });
  it('clasifica los fallos de la red de Chromium (net::ERR_…) como conexión', () => {
    for (const msg of ['net::ERR_INTERNET_DISCONNECTED', 'net::ERR_NAME_NOT_RESOLVED', 'net::ERR_PROXY_CONNECTION_FAILED', 'net::ERR_TUNNEL_CONNECTION_FAILED', 'net::ERR_CONNECTION_RESET', 'Failed to fetch']) {
      const e = classify(new TypeError(msg));
      expect(e.code, msg).toBe('network');
      expect(e.message, msg).toBe(MESSAGES.network);
    }
  });
  it('un certificado no confiable (red que inspecciona el tráfico) tiene su propio mensaje', () => {
    const e = classify(new TypeError('net::ERR_CERT_AUTHORITY_INVALID'));
    expect(e.code).toBe('network');
    expect(e.message).toBe(MESSAGES.certificate);
  });
  it('clasifica cambios de la API interna como "parse"', () => {
    expect(classify(new Error('Failed to extract n decipher function')).code).toBe('parse');
    expect(classify(new Error('Unexpected response shape')).code).toBe('parse');
  });
  it('video borrado/privado/inexistente ("This video is unavailable") es "no disponible", no un error genérico', () => {
    expect(classify(new Error('This video is unavailable')).code).toBe('unavailable');
    expect(classify(new Error('Video unavailable in your country')).code).toBe('region');
    expect(classify(new Error('algo raro')).code).toBe('unknown');
  });
  it('estado de reproducción: región, no disponible y OK', () => {
    expect(playabilityError('OK', undefined)).toBeNull();
    expect(playabilityError('UNPLAYABLE', 'The uploader has not made this video available in your country')!.code).toBe('region');
    expect(playabilityError('LOGIN_REQUIRED', 'Sign in to confirm your age')!.code).toBe('unavailable');
    expect(playabilityError('ERROR', undefined)!.code).toBe('unavailable');
  });
  it('withTimeout rechaza si tarda demasiado', async () => {
    await expect(withTimeout(new Promise(() => undefined), 20)).rejects.toMatchObject({ name: 'TimeoutError' });
    await expect(withTimeout(Promise.resolve(7), 20)).resolves.toBe(7);
  });
});

describe('red del proceso local', () => {
  it('withoutCredentials fuerza credentials:"omit" aunque YouTube.js pida "include", y conserva el resto', async () => {
    let seen: RequestInit | undefined;
    const inner = (async (_input: unknown, init?: RequestInit) => ((seen = init), new Response('ok'))) as unknown as typeof fetch;
    const res = await withoutCredentials(inner)('https://example.test/x', { credentials: 'include', headers: { Range: 'bytes=0-' }, method: 'POST' });
    expect(await res.text()).toBe('ok');
    expect(seen).toMatchObject({ credentials: 'omit', method: 'POST', headers: { Range: 'bytes=0-' } });
  });
  it('funciona sin init', async () => {
    let seen: RequestInit | undefined;
    const inner = (async (_i: unknown, init?: RequestInit) => ((seen = init), new Response())) as unknown as typeof fetch;
    await withoutCredentials(inner)('https://example.test/');
    expect(seen).toEqual({ credentials: 'omit' });
  });
});

describe('evaluador aislado del código remoto', () => {
  it('ejecuta el fragmento y devuelve solo datos', () => {
    expect(evaluatePlayerScript({ output: 'return { n: "abc".split("").reverse().join("") };' })).toEqual({ n: 'cba' });
  });
  it('no tiene acceso a Node ni al sistema de archivos', () => {
    const probe = (code: string) => evaluatePlayerScript({ output: `return { v: ${code} };` }).v;
    expect(probe('typeof require')).toBe('undefined');
    expect(probe('typeof process')).toBe('undefined');
    expect(probe('typeof fetch')).toBe('undefined');
    expect(probe('typeof Buffer')).toBe('undefined');
    expect(probe('typeof globalThis.process')).toBe('undefined');
  });
  it('corta los bucles infinitos', () => {
    expect(() => evaluatePlayerScript({ output: 'while (true) {}' })).toThrow();
  }, 15_000);
});
