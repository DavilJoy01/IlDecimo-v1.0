// mobile/src/components/auth/AuthUnderlineField.tsx
// Label-above-value, underlined (not boxed) field used by the auth screens'
// white card. Text fields get a checkmark once they have a value; secure
// fields get a show/hide toggle instead, since a checkmark can't tell a user
// whether their password looks right the way it can for a phone number.
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View, Pressable, type TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, interpolateColor } from 'react-native-reanimated';
import { colors, typography, spacing } from '@/theme';

const INK = '#122A1F';
const MUTED = '#8A9A92';
const LINE_IDLE = '#DADFDA';

interface AuthUnderlineFieldProps extends TextInputProps {
  label: string;
  // When set, the field renders its TextInput as display-only (no keyboard)
  // and the whole row becomes a Pressable -- used for the date-of-birth
  // field, which opens a native picker instead of taking typed input.
  onPress?: () => void;
}

export function AuthUnderlineField({ label, secureTextEntry, style, onFocus, onBlur, value, onPress, ...props }: AuthUnderlineFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const focus = useSharedValue(0);

  const lineStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(focus.value, [0, 1], [LINE_IDLE, colors.accent]),
  }));

  const hasValue = !!value;

  const field = (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <TextInput
          {...props}
          value={value}
          editable={onPress ? false : props.editable}
          pointerEvents={onPress ? 'none' : undefined}
          secureTextEntry={secureTextEntry && !revealed}
          placeholderTextColor={MUTED}
          style={[styles.input, style]}
          onFocus={(e) => {
            focus.value = withTiming(1, { duration: 180 });
            onFocus?.(e);
          }}
          onBlur={(e) => {
            focus.value = withTiming(0, { duration: 180 });
            onBlur?.(e);
          }}
        />
        {secureTextEntry ? (
          <Pressable onPress={() => setRevealed((v) => !v)} hitSlop={10}>
            <Ionicons name={revealed ? 'eye-off' : 'eye'} size={20} color={MUTED} />
          </Pressable>
        ) : (
          hasValue && <Ionicons name="checkmark" size={20} color={colors.success} />
        )}
      </View>
      <Animated.View style={[styles.line, lineStyle]} />
    </View>
  );

  return onPress ? <Pressable onPress={onPress}>{field}</Pressable> : field;
}

const styles = StyleSheet.create({
  wrapper: { gap: 4 },
  label: { color: colors.background, ...typography.meta, textTransform: 'uppercase', letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.spaceXs },
  input: { flex: 1, color: INK, paddingVertical: spacing.spaceXs, ...typography.body, fontSize: 16 },
  line: { height: 1.5, borderRadius: 1 },
});
