import { KeyboardAvoidingView as NativeKeyboardAvoidingView, Platform, ScrollView, ScrollViewProps, type ViewProps } from 'react-native';
import {
  KeyboardAvoidingView,
  KeyboardAwareScrollView,
  KeyboardAwareScrollViewProps,
} from 'react-native-keyboard-controller';

type Props = KeyboardAwareScrollViewProps & ScrollViewProps;

/** Gap kept between the focused field and the top of the keyboard. */
const FIELD_GAP = 32;

/** Scroll view that scrolls the focused field above the keyboard (Android edge-to-edge and iOS). */
export function KeyboardAwareScrollViewCompat({
  children,
  keyboardShouldPersistTaps = 'handled',
  bottomOffset = FIELD_GAP,
  ...props
}: Props) {
  if (Platform.OS === 'web') {
    return (
      <ScrollView
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        {...props}
      >
        {children}
      </ScrollView>
    );
  }
  return (
    <KeyboardAwareScrollView
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      bottomOffset={bottomOffset}
      {...props}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}

/** Lifts its content above the keyboard; also works inside a Modal on Android. */
export function KeyboardAvoidingViewCompat({ children, ...props }: ViewProps) {
  if (Platform.OS === 'web') return <NativeKeyboardAvoidingView {...props}>{children}</NativeKeyboardAvoidingView>;
  return <KeyboardAvoidingView behavior="padding" {...props}>{children}</KeyboardAvoidingView>;
}
