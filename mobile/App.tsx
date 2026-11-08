import { isRunningInExpoGo, requireNativeView } from 'expo';
import { useEffect, useRef, useState, type Ref } from 'react';
import { BackHandler, Modal, StatusBar, type ViewStyle } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import LocalAudio from './LocalAudio';

type RuntimeHandle = { back(): Promise<void> };
const RuntimeView = isRunningInExpoGo()
  ? null
  : requireNativeView<{ style: ViewStyle; ref: Ref<RuntimeHandle>; onOpenLocal(): void }>('SpotapleRuntime');

export default function App() {
  const runtime = useRef<RuntimeHandle>(null);
  const [localOpen, setLocalOpen] = useState(false);
  useEffect(() => {
    if (!RuntimeView) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!runtime.current) return false;
      void runtime.current.back();
      return true;
    });
    return () => subscription.remove();
  }, []);

  if (!RuntimeView) return <LocalAudio />;
  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#0c0d0f' }}>
        <StatusBar barStyle="light-content" />
        <RuntimeView ref={runtime} style={{ flex: 1 }} onOpenLocal={() => setLocalOpen(true)} />
        <Modal visible={localOpen} animationType="slide" onRequestClose={() => setLocalOpen(false)}>
          {localOpen && <LocalAudio onClose={() => setLocalOpen(false)} />}
        </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
