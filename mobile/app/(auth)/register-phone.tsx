import { useState } from 'react';
import { View, Text, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useRegistration } from '@/hooks/useRegistration';
import { colors, typography, spacing } from '@/theme';
import { PitchDecoration } from '@/components/PitchDecoration';
import { AuthMark } from '@/components/auth/AuthMark';
import { AuthTextInput } from '@/components/auth/AuthTextInput';
import { AuthButton } from '@/components/auth/AuthButton';
import { AuthError } from '@/components/auth/AuthError';

export default function RegisterPhoneScreen() {
  const [phone, setPhone] = useState('');
  const { sendOtp, loading, error } = useRegistration();

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.container}>
        <PitchDecoration />
        <Animated.View entering={FadeInDown.duration(500)}>
          <AuthMark />
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(80).duration(450)}>
          <Text style={styles.title}>Il tuo numero</Text>
          <Text style={styles.subtitle}>Ti invieremo un codice via SMS per verificarlo.</Text>
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(150).duration(450)}>
          <AuthTextInput placeholder="Numero di telefono" keyboardType="phone-pad" autoComplete="tel" value={phone} onChangeText={setPhone} />
        </Animated.View>
        <AuthError message={error} />
        <Animated.View entering={FadeInDown.delay(220).duration(450)}>
          <AuthButton label="Invia codice" onPress={() => sendOtp(phone)} loading={loading} />
        </Animated.View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, justifyContent: 'center', padding: spacing.spaceLg, gap: spacing.spaceSm },
  title: { ...typography.authTitle, color: colors.ink, textTransform: 'uppercase', textAlign: 'center' },
  subtitle: { color: colors.muted, marginBottom: spacing.spaceSm, textAlign: 'center', ...typography.body },
});
