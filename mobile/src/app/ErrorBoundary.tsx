import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, Text as RNText, Pressable, View } from 'react-native';

interface Props {
  children: ReactNode;
}
interface State {
  failed: boolean;
}

/**
 * Last-resort net for render errors so a bug in one screen shows a recoverable message
 * instead of a white screen. It is a class component (the only kind that can catch) and
 * deliberately uses plain React Native primitives and hard-coded colours: it must keep
 * working even when the theme provider is what crashed. No error text or props are shown
 * or logged - they can contain client data.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Hook for crash reporting (Sentry etc.). Intentionally not logging the error object.
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.container} accessibilityRole="alert">
        <RNText style={styles.title}>Something went wrong</RNText>
        <RNText style={styles.body}>The app hit an unexpected problem. Your data is safe.</RNText>
        <Pressable accessibilityRole="button" onPress={() => this.setState({ failed: false })} style={styles.button}>
          <RNText style={styles.buttonText}>Try again</RNText>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#FDF3EC' },
  title: { fontSize: 22, fontWeight: '700', color: '#2C353F', marginBottom: 8 },
  body: { fontSize: 15, color: '#585A5E', textAlign: 'center', marginBottom: 24 },
  button: { backgroundColor: '#1F3B63', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12 },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
