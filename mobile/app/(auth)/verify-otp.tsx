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

export default function VerifyOtpScreen() {
  const [token, setToken] = useState('');
  const { confirmOtp, loading, error } = useRegistration();

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <AuthBackdrop />
      <View style={styles.container}>
        <Animated.View entering={FadeInDown.duration(600)}>
          <AuthMark />
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(80).duration(500)}>
          <Text style={styles.title}>Verifica il codice</Text>
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(160).duration(500)}>
          <AuthGlassCard>
            <AuthTextInput style={styles.otpInput} placeholder="Codice a 6 cifre" keyboardType="number-pad" maxLength={6} value={token} onChangeText={setToken} />
          </AuthGlassCard>
        </Animated.View>
        <AuthError message={error} />
        <Animated.View entering={FadeInDown.delay(230).duration(500)}>
          <AuthButton label="Verifica" onPress={() => confirmOtp(token)} loading={loading} />
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
    marginBottom: spacing.spaceSm,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 12,
  },
  otpInput: { fontFamily: 'Archivo_400Regular', fontSize: 24, textAlign: 'center', letterSpacing: 8 },
});
