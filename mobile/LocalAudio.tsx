import { useState } from 'react';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { getDocumentAsync, type DocumentPickerAsset } from 'expo-document-picker';
import { Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

function formatTime(seconds: number) {
  const elapsed = Math.floor(seconds);
  const minutes = Math.floor(elapsed / 60);
  return `${minutes}:${String(elapsed % 60).padStart(2, '0')}`;
}

function AudioPreview({ file }: { file: DocumentPickerAsset }) {
  const player = useAudioPlayer(file.uri);
  const status = useAudioPlayerStatus(player);
  const [error, setError] = useState(false);
  const { currentTime, duration } = status;
  const progress = duration > 0 ? Math.min(100, 100 * currentTime / duration) : 0;
  const disabled = (!status.isLoaded && !status.playing) || Boolean(status.error);

  async function togglePlayback() {
    setError(false);
    try {
      if (status.playing) {
        player.pause();
        return;
      }
      if (status.didJustFinish || status.playbackState === 'ended') {
        await player.seekTo(0);
      }
      player.play();
    } catch {
      setError(true);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.label}>ARCHIVO LOCAL</Text>
      <Text style={styles.fileName} numberOfLines={2}>{file.name}</Text>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel="Progreso de reproducción"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(progress) }}
        style={styles.progress}
      >
        <View style={[styles.progressFill, { width: `${progress}%` }]} />
      </View>
      <View style={styles.times}>
        <Text style={styles.secondary}>{formatTime(currentTime)}</Text>
        <Text style={styles.secondary}>{formatTime(duration)}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={togglePlayback}
        style={({ pressed }) => [styles.button, styles.playButton, (pressed || disabled) && styles.dimmed]}
      >
        <Text style={styles.playLabel}>{status.playing ? 'Pausar' : 'Reproducir'}</Text>
      </Pressable>
      {status.error || error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          No se pudo reproducir el archivo. Probá con otro audio.
        </Text>
      ) : !status.isLoaded && (
        <Text accessibilityLiveRegion="polite" style={styles.secondary}>Cargando audio…</Text>
      )}
    </View>
  );
}

export default function LocalAudio({ onClose }: { onClose?: () => void }) {
  const [file, setFile] = useState<DocumentPickerAsset | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickerError, setPickerError] = useState(false);

  async function chooseAudio() {
    setPicking(true);
    setPickerError(false);
    try {
      const result = await getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
      if (!result.canceled) setFile(result.assets[0]);
    } catch {
      setPickerError(true);
    } finally {
      setPicking(false);
    }
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <StatusBar barStyle="light-content" />
        <ScrollView contentContainerStyle={styles.content}>
          {onClose && (
            <Pressable accessibilityRole="button" style={[styles.button, styles.fileButton]} onPress={onClose}>
              <Text style={styles.fileButtonLabel}>Volver a Spotaple</Text>
            </Pressable>
          )}
          <Text accessibilityRole="header" style={styles.brand}>Spotaple</Text>
          <Text accessibilityRole="header" style={styles.heading}>Tu música local</Text>
          <Text style={styles.secondary}>Elegí un archivo de audio para escucharlo en el teléfono.</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: picking }}
            disabled={picking}
            onPress={chooseAudio}
            style={({ pressed }) => [styles.button, styles.fileButton, (pressed || picking) && styles.dimmed]}
          >
            <Text style={styles.fileButtonLabel}>{file ? 'Elegir otro audio' : 'Elegir audio'}</Text>
          </Pressable>
          {pickerError && (
            <Text accessibilityRole="alert" style={styles.error}>No se pudo abrir el selector de archivos.</Text>
          )}
          {file && <AudioPreview key={file.uri} file={file} />}
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const accent = '#ff5d73';
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0c0d0f' },
  content: { width: '100%', maxWidth: 520, alignSelf: 'center', padding: 24, gap: 16 },
  brand: { color: accent, fontSize: 20, fontWeight: '800', marginBottom: 24 },
  heading: { color: '#f5f6f8', fontSize: 32, fontWeight: '800' },
  secondary: { color: '#b7bbc4', fontSize: 15, lineHeight: 22 },
  card: { gap: 12, backgroundColor: '#1b1c21', borderRadius: 20, padding: 20 },
  label: { color: '#b7bbc4', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  fileName: { color: '#f5f6f8', fontSize: 20, fontWeight: '700' },
  progress: { height: 5, borderRadius: 4, backgroundColor: '#2e3037', overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: accent },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  button: { minHeight: 48, alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: 12 },
  playButton: { backgroundColor: accent },
  playLabel: { color: '#1c0a0e', fontWeight: '800' },
  fileButton: { borderColor: '#666d78', borderWidth: 1 },
  fileButtonLabel: { color: '#f5f6f8', fontWeight: '700' },
  dimmed: { opacity: 0.6 },
  error: { color: '#ffb4ab', fontSize: 15 },
});
