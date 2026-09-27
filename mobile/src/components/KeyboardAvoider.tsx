import { useRef, useState } from 'react';
import { KeyboardAvoidingView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

interface KeyboardAvoiderProps {
  children: React.ReactNode;
  /** Applied to the padded container that lays out the children (e.g. justifyContent for a bottom sheet). */
  style?: StyleProp<ViewStyle>;
}

/**
 * Lifts its content above the keyboard on both platforms.
 *
 * Android is edge-to-edge here (windowSoftInputMode=adjustResize no longer resizes the window), so
 * without this the keyboard sits on top of the lower fields. KeyboardAvoidingView pads by how far the
 * keyboard overlaps its frame, which is 0 when the window did resize, so padding is safe everywhere.
 *
 * KeyboardAvoidingView compares its parent-relative frame with a screen-relative keyboard position and
 * expects the caller to pass the difference as keyboardVerticalOffset. That difference is the view's
 * distance from the top of the window (status bar, native header), so it is measured instead of guessed.
 */
export function KeyboardAvoider({ children, style }: KeyboardAvoiderProps) {
  const ref = useRef<View>(null);
  const [offset, setOffset] = useState(0);

  const measure = () => {
    ref.current?.measureInWindow((_x, y) => setOffset(Math.round(y)));
  };

  return (
    <View ref={ref} onLayout={measure} style={styles.fill}>
      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={offset} style={[styles.fill, style]}>
        {children}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
