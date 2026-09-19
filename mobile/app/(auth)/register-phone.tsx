import { useState } from 'react';
import { View, Text, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useRegistration } from '@/hooks/useRegistration';
import { colors, typography, spacing } from '@/theme';
import { AuthBackdrop } from '@/components/auth/AuthBackdrop';
import { AuthMark } from '@/components/auth/AuthMark';
import { AuthGlassCard } from '@/components/auth/AuthGlassCard';
import { AuthTextInput } from '@/components/auth/AuthTextInput';
import { AuthButton } from '@/components/auth/AuthButton';
import { AuthError } from '@/components/auth/AuthError';

export default function RegisterPhoneScreen() {
  const [phone, setPhone] = useState('');
  const { sendOtp, loading, error } = useRegistration();

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <AuthBackdrop />
      <View style={styles.container}>
        <Animated.View entering={FadeInDown.duration(600)}>
          <AuthMark />
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(80).duration(500)}>
          <Text style={styles.title}>Il tuo numero</Text>
          <Text style={styles.subtitle}>Ti invieremo un codice via SMS per verificarlo.</Text>
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(160).duration(500)}>
          <AuthGlassCard>
            <AuthTextInput placeholder="Numero di telefono" keyboardType="phone-pad" autoComplete="tel" value={phone} onChangeText={setPhone} />
          </AuthGlassCard>
        </Animated.View>
        <AuthError message={error} />
        <Animated.View entering={FadeInDown.delay(230).duration(500)}>
          <AuthButton label="Invia codice" onPress={() => sendOtp(phone)} loading={loading} />
        </Animated.View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, justifyContent: 'center', padding: spacing.spaceLg, gap: spacing.spaceSm },
  title: {
    ...typography.authTitle,
    fontSize: 30,
    color: colors.ink,
    textTransform: 'uppercase',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 12,
  },
  subtitle: { color: colors.muted, marginBottom: spacing.spaceSm, textAlign: 'center', ...typography.body },
});
