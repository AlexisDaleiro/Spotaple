import { describe, expect, it } from 'vitest';
import { AUDIO_FORMATS, exportFileName, formatFromExt, formatFromMime, parseFormat } from '../src/shared/offline';
import type { Track } from '../src/shared/types';

const t = (title: string, ...artists: string[]): Track => ({ id: 'abcDEF12345', title, artists: artists.map((name) => ({ name })) });

describe('formatos de audio', () => {
  it('describe cada formato con su extensión, tipo y etiqueta', () => {
    expect(AUDIO_FORMATS.opus).toEqual({ ext: 'webm', mime: 'audio/webm', label: 'Opus (.webm)' });
    expect(AUDIO_FORMATS.aac).toEqual({ ext: 'm4a', mime: 'audio/mp4', label: 'AAC (.m4a)' });
  });

  it('formatFromMime reconoce Opus y AAC y rechaza el resto', () => {
    expect(formatFromMime('audio/webm')).toBe('opus');
    expect(formatFromMime('audio/mp4')).toBe('aac');
    expect(formatFromMime('audio/ogg')).toBeNull();
  });

  it('formatFromExt reconoce webm y m4a', () => {
    expect(formatFromExt('webm')).toBe('opus');
    expect(formatFromExt('m4a')).toBe('aac');
    expect(formatFromExt('mp3')).toBeNull();
  });

  it('parseFormat solo acepta los nombres de formato', () => {
    expect(parseFormat('opus')).toBe('opus');
    expect(parseFormat('aac')).toBe('aac');
    expect(parseFormat('mp3')).toBeNull();
    expect(parseFormat(undefined)).toBeNull();
  });
});

describe('exportFileName', () => {
  it('arma «Artista - Título.ext»', () => {
    expect(exportFileName(t('One More Time', 'Daft Punk'), 'opus')).toBe('Daft Punk - One More Time.webm');
  });

  it('une varios artistas con coma', () => {
    expect(exportFileName(t('T', 'A', 'B'), 'aac')).toBe('A, B - T.m4a');
  });

  it('reemplaza los caracteres que Windows prohíbe', () => {
    expect(exportFileName(t('Back In Black?', 'AC/DC'), 'opus')).toBe('AC_DC - Back In Black_.webm');
    expect(exportFileName(t('a<b>c:d"e\\f|g*h\u0007i'), 'opus')).toBe('a_b_c_d_e_f_g_h_i.webm');
  });

  it('antepone _ a los nombres reservados de Windows, sin distinguir mayúsculas', () => {
    expect(exportFileName(t('CON'), 'opus')).toBe('_CON.webm');
    expect(exportFileName(t('com1'), 'aac')).toBe('_com1.m4a');
  });

  it('recorta espacios y puntos del final', () => {
    expect(exportFileName(t('Hola. . '), 'opus')).toBe('Hola.webm');
  });

  it('corta el nombre a 150 caracteres', () => {
    const name = exportFileName(t('x'.repeat(300)), 'opus');
    expect(name.length).toBe(150 + '.webm'.length);
  });

  it('usa «Sin título» si no queda nada', () => {
    expect(exportFileName(t('...'), 'opus')).toBe('Sin título.webm');
    expect(exportFileName(t(''), 'aac')).toBe('Sin título.m4a');
  });
});
